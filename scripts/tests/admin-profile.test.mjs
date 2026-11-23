// An instructor account is paired with a profile, and a show can be put on
// an instructor's own list or shared with another instructor. Runs the real
// cueola-admin-auth.js against a pretend cloud.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert';
import { fileURLToPath } from 'node:url'; import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const store = { 'admins/u1': {username:'jon', name:'Jon K', level:'super'}, 'profiles/sam': {username:'sam', role:'student', sessions:[]},
  'admins/u2': {username:'pat', name:'Pat', level:'standard'}, 'sessions/2611AB': {code:'2611AB'} };
let authCb=null;
const window = { addEventListener(){}, dispatchEvent(){}, CustomEvent: class{},
  _db:{}, _doc:(db,...p)=>({path:p.join('/')}), _collection:(db,name)=>({coll:name}),
  _getDoc: async r => ({ exists:()=>r.path in store, data:()=>structuredClone(store[r.path]) }),
  _setDoc: async (r,d) => { store[r.path]=structuredClone(d); },
  _updateDoc: async (r,d) => { const cur=store[r.path]; if(!cur) throw Object.assign(new Error('nf'),{code:'not-found'});
    for (const [k,v] of Object.entries(d)) { if (v&&v.__u) cur[k]=[...new Set([...(cur[k]||[]),...v.__u])]; else if (v&&v.__r) cur[k]=(cur[k]||[]).filter(x=>!v.__r.includes(x)); else cur[k]=v; } },
  _getDocs: async c => { const docs=Object.entries(store).filter(([k])=>k.startsWith(c.coll+'/')).map(([k,v])=>({id:k.split('/')[1],data:()=>v})); return { forEach:f=>docs.forEach(f), docs }; },
  _arrayUnion:(...a)=>({__u:a}), _arrayRemove:(...a)=>({__r:a}),
  _adminAuth:{app:{options:{}}}, _authFns:{ onAuthStateChanged:(a,cb)=>{authCb=cb; return ()=>{}}, signOut: async()=>{},
    initializeApp:()=>({}), getAuth:()=>({}), deleteApp: async()=>{},
    createUserWithEmailAndPassword: async (a,email)=>({user:{uid:'u9', delete: async()=>{}}}) },
};
const ctx = vm.createContext({ window, console, setTimeout:()=>{}, clearTimeout(){}, Promise, JSON, String, Date, Math, Array, Object, Error, Uint32Array, crypto: globalThis.crypto, CustomEvent: class{} });
vm.runInContext(fs.readFileSync(path.join(root, 'cueola-admin-auth.js'),'utf8'), ctx);
const A = window.CueolaAdminAuth;
authCb({uid:'u1', email:'jon@admins.cueola.app', getIdTokenResult: async()=>({claims:{}})});
await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r)); await new Promise(r=>setImmediate(r));
assert.equal(A.current().username,'jon');
// self-heal made jon's profile + an instructor key
await A.ensureProfile(A.current());
assert.equal(store['profiles/jon'].role,'admin');
const key = store['profiles/jon'].codeUsed; assert.ok(store['accessCodes/'+key].active && store['accessCodes/'+key].role==='admin');
// student username refused
assert.equal((await A.ensureProfile({username:'sam'})).reason,'student-username');
await assert.rejects(A.createInstructor({username:'sam',name:'S',password:'12345678'}), /student profile/);
// create instructor makes admins doc + profile, reusing the key
const made = await A.createInstructor({username:'newbie',name:'New B',password:'12345678'});
assert.equal(made.profile,true); assert.equal(store['profiles/newbie'].codeUsed,key); assert.equal(store['admins/u9'].username,'newbie');
// claim + share
assert.deepEqual((await A.addShowsToProfile(A.current(),['2611ab','2611AB','x'])).added,['2611AB']);
assert.deepEqual((await A.addShowsToProfile(A.current(),['2611AB'])).added,[]);
const admins = await A.listAdmins(); assert.equal(admins.length,3);
const pat = admins.find(a=>a.username==='pat');
assert.equal((await A.shareShow('2611AB',pat)).ok,true);
assert.deepEqual(store['profiles/pat'].sessions,['2611AB']); assert.deepEqual(store['sessions/2611AB'].sharedWith,['u2']);
assert.equal((await A.unshareShow('2611AB',pat)).ok,true);
assert.deepEqual(store['profiles/pat'].sessions,[]); assert.deepEqual(store['sessions/2611AB'].sharedWith,[]);
console.log('admin-profile: all checks passed');
