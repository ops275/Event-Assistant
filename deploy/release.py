#!/usr/bin/env python3
"""Root-owned qooob release receiver. No builds or production secrets in artifacts."""
import base64, contextlib, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request
STATE=pathlib.Path('/var/lib/qooob-deploy')
STAGE=pathlib.Path('/srv/qooob-staging')
PROD=pathlib.Path('/root/event-bot/current')
WORKERS=['onlyplay-bot','onlyplay-slack','onlyplay-web','onlyplay-onboarding','onlyplay-reminders']
MAX_ARCHIVE=450*1024*1024
MAX_EXPANDED=900*1024*1024

def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()

def validate_path(name):
 p=pathlib.PurePosixPath(name)
 if not name or name!=p.as_posix() or p.is_absolute() or any(x in ('..','.') for x in p.parts) or '\\' in name or ':' in name:raise ValueError('Unsafe archive path')
 if name=='release.json':return name
 if p.parts[0]=='node_modules' and len(p.parts)>1:return name
 if name in ('package.json','package-lock.json'):return name
 if p.parts[0] not in ('bot','calendar-web','slack','scripts') or len(p.parts)<2:raise ValueError('Unexpected source path')
 if p.parts[0]=='scripts' and name not in ('scripts/start-staging.mjs','scripts/staging-config.mjs'):raise ValueError('Unexpected script')
 if any(x.lower() in ('data','private','test','tests','__pycache__','node_modules') or x.endswith('-private') for x in p.parts):raise ValueError('Private/non-runtime path')
 if any(x.startswith('.') for x in p.parts) or re.search(r'(credentials|client_secret|tokens|sessions|state|ledger).*\.json$|\.(env|key|pem|p12|pfx|session|db|sqlite)$',p.name,re.I):raise ValueError('Private file path')
 return name

def safe_target(root,name):
 validate_path(name)
 target=root/name
 for p in [target,*target.parents]:
  if p==root:break
  if p.is_symlink():raise ValueError('Symlink in application path')
 return target

def unpack(archive,dest):
 dest.mkdir(parents=True,exist_ok=False)
 seen=set();total=0
 with tarfile.open(archive,'r:gz') as t:
  for m in t:
   validate_path(m.name)
   if not m.isfile() or m.name in seen:raise ValueError('Only unique regular files allowed')
   total+=m.size
   if total>MAX_EXPANDED or len(seen)>50000:raise ValueError('Archive limit exceeded')
   seen.add(m.name)
   out=safe_target(dest,m.name);out.parent.mkdir(parents=True,exist_ok=True)
   with t.extractfile(m) as src,open(out,'xb') as dst:shutil.copyfileobj(src,dst)
   os.chmod(out,0o755 if m.mode&0o111 else 0o644)
 manifest=json.loads((dest/'release.json').read_text())
 if not all(re.fullmatch('[0-9a-f]{40}',manifest.get(k,'')) for k in ('commit','tree')):raise ValueError('Invalid release identity')
 files=manifest.get('files',{})
 if set(files)!=seen-{'release.json'}:raise ValueError('Manifest membership mismatch')
 for name,sha in files.items():
  if not re.fullmatch('[0-9a-f]{64}',sha) or digest(dest/name)!=sha:raise ValueError('Release hash mismatch')
 return manifest

def require_receipt(receipt,tree,archive):
 if receipt.get('tree')!=tree or receipt.get('archive')!=archive or receipt.get('healthy') is not True or receipt.get('accepted') is not True:raise ValueError('Exact healthy staging artifact must be explicitly accepted first')

def runtime(files):return {p:h for p,h in files.items() if not p.startswith(('node_modules/','scripts/'))}

def plan(root,baseline,incoming):
 # Intentional deletion needs a migration; do not silently leave old code running.
 if set(baseline)-set(incoming):raise ValueError('Source removal requires explicit migration')
 for name,sha in baseline.items():
  p=safe_target(root,name)
  if (digest(p) if p.is_file() else None)!=sha:raise ValueError('Production baseline drift: '+name)
 changes=[]
 for name,sha in incoming.items():
  p=safe_target(root,name)
  actual=digest(p) if p.is_file() else None
  if name not in baseline and actual is not None:raise ValueError('Unmanaged production path collision: '+name)
  if actual!=sha:changes.append(name)
 return sorted(changes)

def affected(paths):
 names=set()
 for p in paths:
  if p in ('package.json','package-lock.json') or p.startswith('node_modules/'):names.update(WORKERS)
  elif p.startswith('bot/'):
   names.add('onlyplay-bot')
   if p=='bot/services/followupTemplates.js':names.add('onlyplay-onboarding')
  elif p.startswith('slack/'):names.add('onlyplay-slack')
  elif p.startswith('calendar-web/'):names.update(WORKERS[2:])
 return [p for p in WORKERS if p in names]

def read(path):return json.loads(path.read_text())
def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');os.replace(tmp,path)
def run(*args):return subprocess.check_output(args,text=True,stderr=subprocess.PIPE,timeout=90)
def link(path,target):
 tmp=path.with_name(path.name+'.next');tmp.unlink(missing_ok=True);tmp.symlink_to(target);os.replace(tmp,path)
def pm2():
 rows=json.loads(run('pm2','jlist'))
 found={p['name']:p for p in rows if p['name'] in WORKERS}
 if set(found)!=set(WORKERS) or any(p['pm2_env']['status']!='online' for p in found.values()):raise ValueError('Production workers not healthy')
 if any(pathlib.Path(p['pm2_env']['pm_cwd']).resolve()!=PROD.resolve() for p in found.values()):raise ValueError('Unexpected PM2 application root')
 return {name:p['pid'] for name,p in found.items()}
def health(stage):
 url='https://'+('staging.' if stage else '')+'qooob.81.27.103.54.sslip.io/health'
 for _ in range(20):
  try:
   with urllib.request.urlopen(url,timeout=5) as f:
    if json.load(f).get('ok') is True:return
  except Exception:pass
  time.sleep(2)
 raise ValueError('Public health check failed')
def identity(stage):
 # Credentials stay server-side; never include provider exception URLs in output.
 env=pathlib.Path('/etc/qooob-staging/bot.env' if stage else '/etc/onlyplay/bot.env').read_text()
 candidates=[]
 for line in env.splitlines():
  if '=' in line and not line.lstrip().startswith('#'):
   k,v=line.split('=',1)
   if 'TOKEN' in k:candidates.append(v.strip().strip(chr(34)).strip(chr(39)))
 expected=9280625084 if stage else 8344814605
 token=next((v for v in candidates if v.startswith(str(expected)+':')),None)
 if not token:raise ValueError('Configured bot identity not found')
 try:
  with urllib.request.urlopen('https://api.telegram.org/bot'+token+'/getMe',timeout=15) as f:result=json.load(f)
  if not result.get('ok') or result.get('result',{}).get('id')!=expected:raise ValueError()
 except Exception:raise ValueError('Bot identity check failed') from None

def stage(sha,tree,archive_hash):
 for value,n in ((sha,40),(tree,40),(archive_hash,64)):
  if not re.fullmatch('[0-9a-f]{'+str(n)+'}',value):raise ValueError('Invalid deployment identity')
 if shutil.disk_usage(STATE).free<MAX_EXPANDED*2:raise ValueError('Insufficient free disk for staging')
 with tempfile.TemporaryDirectory(prefix='upload-',dir=STATE) as td:
  archive=pathlib.Path(td)/'release.tar.gz'
  total=0
  with archive.open('wb') as out:
   while True:
    block=sys.stdin.buffer.read(1024*1024)
    if not block:break
    total+=len(block)
    if total>MAX_ARCHIVE:raise ValueError('Upload too large')
    out.write(block)
  if digest(archive)!=archive_hash:raise ValueError('Archive digest mismatch')
  candidate=pathlib.Path(td)/'release';manifest=unpack(archive,candidate)
  if (manifest['commit'],manifest['tree'])!=(sha,tree):raise ValueError('Archive identity mismatch')
  if not (candidate/'node_modules').is_dir():raise ValueError('Dependencies must be built off-host')
  target=STAGE/'releases'/sha
  if target.exists():
   saved=read(target/'release.json')
   if saved!=manifest or any(digest(safe_target(target,p))!=h for p,h in manifest['files'].items()):raise ValueError('Immutable release already exists with different bytes')
  else:shutil.move(str(candidate),target)
  previous=(STAGE/'current').resolve();prod_pids=pm2();identity(True)
  try:
   link(STAGE/'current',target)
   run('systemctl','restart','qooob-staging@bot','qooob-staging@web')
   run('systemctl','is-active','qooob-staging@bot','qooob-staging@web');health(True);identity(True)
   if pm2()!=prod_pids:raise ValueError('Production PID changed during staging')
  except Exception:
   link(STAGE/'current',previous);run('systemctl','restart','qooob-staging@bot','qooob-staging@web');raise
  receipt={'commit':sha,'tree':tree,'archive':archive_hash,'healthy':True,'accepted':False,'previous':str(previous),'time':int(time.time())}
  write(STATE/'receipts'/f'{tree}.json',receipt)
  shutil.copyfile(archive,STATE/'artifacts'/f'{tree}.tar.gz')
  print(json.dumps(receipt))

def baseline(root,files):
 return {name:(digest(safe_target(root,name)) if safe_target(root,name).is_file() else None) for name in files}

def restore(root,backup,record):
 for name in record['changes']:
  target=safe_target(root,name);old=backup/'files'/name
  if old.exists():target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(old,target)
  else:target.unlink(missing_ok=True)
 if (backup/'node_modules').exists():
  current=root/'node_modules'
  if current.exists():shutil.rmtree(current)
  shutil.move(str(backup/'node_modules'),current)
 for worker in record['workers']:run('pm2','restart',worker)
 health(False);identity(False);pm2()

def promote(tree):
 if not re.fullmatch('[0-9a-f]{40}',tree):raise ValueError('Invalid tree')
 receipt=read(STATE/'receipts'/f'{tree}.json');archive=STATE/'artifacts'/f'{tree}.tar.gz'
 require_receipt(receipt,tree,digest(archive));root=PROD.resolve();before_pids=pm2();identity(False);private_before=private_hashes()
 if shutil.disk_usage(STATE).free<MAX_EXPANDED*2:raise ValueError('Insufficient free disk for promotion and rollback')
 with tempfile.TemporaryDirectory(prefix='promote-',dir=STATE) as td:
  candidate=pathlib.Path(td)/'release';manifest=unpack(archive,candidate)
  if manifest['tree']!=tree:raise ValueError('Manifest tree mismatch')
  incoming=runtime(manifest['files']);base=read(STATE/'production-baseline.json')
  if base['root']!=str(root):raise ValueError('Production symlink changed since baseline')
  changes=plan(root,base['files'],incoming)
  if installed_dependencies(root)!=base['dependency_hash']:raise ValueError('Production dependency baseline drift')
  # Dependencies are always promoted from the tested archive, never rebuilt.
  deps_changed=base['dependency_hash']!=dependency_hash(manifest['files'])
  workers=affected(changes+(['node_modules/'] if deps_changed else []))
  backup=STATE/'backups'/(str(time.time_ns())+'-'+tree[:12]);backup.mkdir(parents=True)
  record={'tree':tree,'commit':manifest['commit'],'root':str(root),'changes':changes,'workers':workers,'baseline':base}
  write(backup/'record.json',record)
  for name in changes:
   src=safe_target(root,name)
   if src.exists():dst=backup/'files'/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
  try:
   if deps_changed:
    # Prepare the complete dependency tree before touching the active path.
    prepared=root/'node_modules.next'
    if prepared.exists():raise ValueError('Dependency staging path already exists')
    shutil.copytree(candidate/'node_modules',prepared)
    shutil.move(str(root/'node_modules'),backup/'node_modules');os.replace(prepared,root/'node_modules')
   for name in changes:
    dst=safe_target(root,name);dst.parent.mkdir(parents=True,exist_ok=True)
    temp=dst.with_name(dst.name+'.deploy-next');shutil.copy2(candidate/name,temp);os.replace(temp,dst)
   for worker in workers:run('pm2','restart',worker)
   health(False);identity(False);after_pids=pm2()
   if any(after_pids[w]!=before_pids[w] for w in WORKERS if w not in workers):raise ValueError('Unaffected production worker restarted')
   if private_hashes()!=private_before:raise ValueError('Private production configuration changed')
   if any(digest(safe_target(root,p))!=h for p,h in incoming.items()):raise ValueError('Deployed source hash mismatch')
  except Exception:
   restore(root,backup,record);write(backup/'failed.json',{'rolled_back':True});raise
  write(STATE/'production-baseline.json',{'root':str(root),'files':incoming,'dependency_hash':dependency_hash(manifest['files'])})
  write(STATE/'production.json',{'tree':tree,'commit':manifest['commit'],'backup':str(backup),'time':int(time.time())})
  print(json.dumps({'production':tree,'backup':str(backup),'restarted':workers}))

def installed_dependencies(root):
 files={}
 deps=root/'node_modules'
 if deps.is_symlink() or not deps.is_dir():raise ValueError('Expected independent dependency directory')
 for directory,dirs,names in os.walk(deps,followlinks=False):
  if any((pathlib.Path(directory)/d).is_symlink() for d in dirs):raise ValueError('Dependency directory symlink')
  for name in names:
   p=pathlib.Path(directory)/name
   if p.is_symlink() and not p.resolve().is_relative_to(deps.resolve()):raise ValueError('External dependency symlink')
   files[p.relative_to(root).as_posix()]=digest(p)
 return dependency_hash(files)

def private_hashes():
 return {str(p):digest(p) for p in map(pathlib.Path,['/etc/onlyplay/bot.env','/etc/onlyplay/ecosystem.config.js','/etc/onlyplay/slack.json'])}

def dependency_hash(files):
 return hashlib.sha256(json.dumps({p:h for p,h in sorted(files.items()) if p.startswith('node_modules/')},sort_keys=True).encode()).hexdigest()

def oidc_keys():
 with urllib.request.urlopen('https://token.actions.githubusercontent.com/.well-known/jwks',timeout=15) as response:return json.load(response)

def github_tree(sha):
 if not re.fullmatch('[0-9a-f]{40}',sha):raise ValueError('Invalid GitHub commit')
 req=urllib.request.Request('https://api.github.com/repos/ops275/Event-Assistant/git/commits/'+sha,headers={'Accept':'application/vnd.github+json','User-Agent':'qooob-deploy'})
 with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)['tree']['sha']

def verify_oidc(token,scope,commit=None,tree=None):
 # Validate on the server: repository secrets alone do not authorize a feature branch.
 try:
  from cryptography.hazmat.primitives.asymmetric import rsa,padding
  from cryptography.hazmat.primitives import hashes
  if len(token)>24000 or scope not in ('staging','production'):raise ValueError()
  head,body,sig=token.split('.')
  def decode(s):return base64.urlsafe_b64decode(s+'='*((-len(s))%4))
  header=json.loads(decode(head));claims=json.loads(decode(body))
  if header.get('alg')!='RS256' or not isinstance(header.get('kid'),str):raise ValueError()
  jwk=next(k for k in oidc_keys()['keys'] if k['kid']==header['kid'] and k['kty']=='RSA')
  public=rsa.RSAPublicNumbers(int.from_bytes(decode(jwk['e']),'big'),int.from_bytes(decode(jwk['n']),'big')).public_key()
  if public.key_size<2048:raise ValueError()
  public.verify(decode(sig),(head+'.'+body).encode(),padding.PKCS1v15(),hashes.SHA256())
  branch='staging' if scope=='staging' else 'main';now=time.time()
  expected={'iss':'https://token.actions.githubusercontent.com','aud':'qooob-deploy','repository':'ops275/Event-Assistant','repository_id':'1440183136','ref':'refs/heads/'+branch,'event_name':'push','workflow_ref':'ops275/Event-Assistant/.github/workflows/check.yml@refs/heads/'+branch}
  if any(claims.get(k)!=v for k,v in expected.items()):raise ValueError()
  if claims['exp']<now or claims['nbf']>now+30 or not now-600<=claims['iat']<=now+30:raise ValueError()
  if commit and claims.get('sha')!=commit:raise ValueError()
  if tree and github_tree(claims['sha'])!=tree:raise ValueError()
 except Exception:raise ValueError('GitHub Actions identity/branch/commit verification failed') from None

def main():
 if os.geteuid()!=0:raise ValueError('Root receiver required')
 STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
 for d in ('receipts','artifacts','backups'):(STATE/d).mkdir(mode=0o700,exist_ok=True)
 import fcntl
 with (STATE/'lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  args=sys.argv[1:]
  if args[:1]==['ssh']:
   scope=args[1];cmd=os.environ.get('SSH_ORIGINAL_COMMAND','').split()
   if scope=='staging' and len(cmd)==5 and cmd[0]=='stage':
    verify_oidc(cmd[4],scope,cmd[1],cmd[2]);stage(*cmd[1:4])
   elif scope=='production' and len(cmd)==3 and cmd[0]=='promote':
    verify_oidc(cmd[2],scope,tree=cmd[1]);promote(cmd[1])
   else:raise ValueError('SSH command not permitted')
  elif args[:1]==['accept'] and len(args)>=3:
   tree=args[1]
   if not re.fullmatch('[0-9a-f]{40}',tree):raise ValueError('Invalid tree')
   receipt=read(STATE/'receipts'/f'{tree}.json')
   if (STAGE/'current').resolve().name!=receipt['commit']:raise ValueError('Only current staging release can be accepted')
   health(True);identity(True)
   receipt.update(accepted=True,acceptance_note=' '.join(args[2:]),accepted_at=int(time.time()));write(STATE/'receipts'/f'{tree}.json',receipt)
   print('Accepted staging tree',tree)
  elif args[:1]==['baseline'] and len(args)==2:
   if (STATE/'production-baseline.json').exists():raise ValueError('Baseline already initialized')
   manifest=read(pathlib.Path(args[1]));root=PROD.resolve();pm2();identity(False)
   files=baseline(root,runtime(manifest['files']))
   # Missing files are omitted, existing tracked files are recorded without copying private data.
   write(STATE/'production-baseline.json',{'root':str(root),'files':{p:h for p,h in files.items() if h is not None},'dependency_hash':installed_dependencies(root)})
   print('Production baseline recorded:',len(files),'paths')
  elif args==['rollback']:
   current=read(STATE/'production.json');backup=pathlib.Path(current['backup']);record=read(backup/'record.json');root=PROD.resolve()
   base=read(STATE/'production-baseline.json');plan(root,base['files'],base['files'])
   if installed_dependencies(root)!=base['dependency_hash']:raise ValueError('Production dependency baseline drift')
   if str(root)!=record['root']:raise ValueError('Production root changed')
   restore(root,backup,record);write(STATE/'production-baseline.json',record['baseline'])
   write(STATE/'production.json',{'rolled_back':current,'time':int(time.time())});print('Production rollback complete')
  else:raise ValueError('Unsupported command')

if __name__=='__main__':
 try:main()
 except Exception as e:
  # Do not print external process/provider output or credential-bearing exception URLs.
  print('Deployment failed: '+(str(e) if isinstance(e,ValueError) else type(e).__name__),file=sys.stderr);sys.exit(1)
