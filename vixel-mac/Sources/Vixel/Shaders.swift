/// The graphics card's side of the picture, in Metal's shading language.
///
/// Every surface is drawn the same way. For each pixel of the output, the
/// warp is undone to find where that pixel sits on the surface's own square
/// (0 to 1 each way). Outside the square the pixel is left alone, so
/// everywhere outside a surface stays black. Inside, it draws the test
/// pattern, or reads the video at the matching spot of the picture.
///
/// It is compiled when Vixel opens, so the app needs no extra build step.
enum Shaders {
    static let source = """
    #include <metal_stdlib>
    using namespace metal;

    struct Corners { float4 position [[position]]; };

    // One triangle big enough to cover the whole view.
    vertex Corners coverAll(uint id [[vertex_id]]) {
        float2 p = float2((id << 1) & 2, id & 2);
        Corners out;
        out.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
        return out;
    }

    struct Layer {
        float3x3 toSquare;   // a pixel of this view -> the surface's own square
        float3x3 toPicture;  // the surface's square -> the part of the picture it shows
        float4 color;        // the solid color
        float4 info;         // x: what it shows, y: grid columns, z: grid rows, w: line width in pixels
    };

    // How strongly a line w pixels wide covers a pixel d pixels from its middle.
    static float line(float d, float w) {
        return 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, d);
    }

    fragment float4 drawSurface(Corners in [[stage_in]],
                                constant Layer &layer [[buffer(0)]],
                                texture2d<float> picture [[texture(0)]],
                                sampler pictureSampler [[sampler(0)]]) {
        float3 q = layer.toSquare * float3(in.position.xy, 1.0);
        float2 st = q.xy / q.z;
        float2 cells = max(layer.info.yz, float2(1.0));
        float lw = layer.info.w;

        // Every measure that needs the neighbouring pixels is taken here,
        // before any pixel can drop out.
        float2 fw = max(fwidth(st), float2(1e-7));
        float2 c = (st - 0.5) * cells;
        float r = length(c);
        float fr = max(fwidth(r), 1e-7);
        float d1 = st.x - st.y, d2 = st.x + st.y - 1.0;
        float fd1 = max(fwidth(d1), 1e-7), fd2 = max(fwidth(d2), 1e-7);

        // How much of this pixel the surface covers: a soft edge one pixel wide.
        float2 inside = min(st, 1.0 - st) / fw;
        float cover = q.z > 0.0 ? saturate(min(inside.x, inside.y) + 0.5) : 0.0;
        if (cover <= 0.0) { return float4(0.0); }

        float edgeDistance = min(inside.x, inside.y);
        float2 mid = abs(st - 0.5) / fw;
        int kind = int(layer.info.x + 0.5);
        float3 rgb = float3(0.0);

        if (kind == 0) {
            // Grid: white lines on black, a heavier frame and middle cross,
            // and a circle that shows at once if the surface is squashed.
            float2 toLine = abs(fract(st * cells + 0.5) - 0.5) / cells / fw;
            float v = max(line(toLine.x, lw), line(toLine.y, lw));
            v = max(v, line(edgeDistance, lw * 4.0));
            v = max(v, max(line(mid.x, lw * 2.0), line(mid.y, lw * 2.0)));
            v = max(v, line(abs(r - min(cells.x, cells.y) * 0.5) / fr, lw * 1.5));
            rgb = float3(v);
        } else if (kind == 1) {
            // Crosshair: the frame, the middle cross, both diagonals and a
            // small circle in the middle.
            float v = line(edgeDistance, lw * 4.0);
            v = max(v, max(line(mid.x, lw * 1.5), line(mid.y, lw * 1.5)));
            v = max(v, max(line(abs(d1) / fd1, lw), line(abs(d2) / fd2, lw)));
            v = max(v, line(abs(r - min(cells.x, cells.y) * 0.15) / fr, lw * 1.5));
            rgb = float3(v);
        } else if (kind == 2) {
            // Color bars at 75%, the usual seven, over a gray scale in
            // eleven steps from black to white.
            if (st.y < 0.75) {
                const float3 bars[7] = {
                    float3(0.75, 0.75, 0.75), float3(0.75, 0.75, 0.0), float3(0.0, 0.75, 0.75),
                    float3(0.0, 0.75, 0.0), float3(0.75, 0.0, 0.75), float3(0.75, 0.0, 0.0),
                    float3(0.0, 0.0, 0.75)
                };
                rgb = bars[clamp(int(st.x * 7.0), 0, 6)];
            } else {
                rgb = float3(float(clamp(int(st.x * 11.0), 0, 10)) / 10.0);
            }
        } else if (kind == 3) {
            rgb = layer.color.rgb;
        } else if (kind == 4) {
            float3 p = layer.toPicture * float3(st, 1.0);
            rgb = picture.sample(pictureSampler, p.xy / p.z).rgb;
        }
        // Anything else (a video that is not ready) stays black.

        // The surface covers what is under it, with its soft edge.
        return float4(rgb * cover, cover);
    }
    """
}
