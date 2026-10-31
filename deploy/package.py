#!/usr/bin/env python3
"""Build on Linux/Node22, after tests. Package runtime source and installed dependencies."""
import gzip,hashlib,io,json,os,pathlib,subprocess,tarfile
from release import validate_path,digest,MAX_EXPANDED

def build(root,output):
 files={}
 tracked=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split(chr(0))
 for name in tracked:
  if not name:continue
  if name not in ('package.json','package-lock.json') and not name.startswith(('bot/','calendar-web/','slack/','scripts/start-staging.mjs','scripts/staging-config.mjs')):continue
  if any(p in ('test','tests') for p in pathlib.PurePosixPath(name).parts):continue
  validate_path(name)
  if (root/name).is_symlink():raise ValueError('Source symlink forbidden')
  files[name]=digest(root/name)
 deps=root/'node_modules'
 if not deps.is_dir():raise ValueError('Install and test dependencies first')
 for directory,dirs,names in os.walk(deps,followlinks=False):
  if any((pathlib.Path(directory)/d).is_symlink() for d in dirs):raise ValueError('Dependency directory symlink forbidden')
  for name in names:
   p=pathlib.Path(directory)/name
   if p.is_symlink() and not p.resolve().is_relative_to(deps.resolve()):raise ValueError('External dependency symlink')
   relative=p.relative_to(root).as_posix();validate_path(relative);files[relative]=digest(p)
 manifest={'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'tree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=root,text=True).strip(),'files':files}
 if sum((root/p).stat().st_size for p in files)>MAX_EXPANDED:raise ValueError('Release too large')
 with output.open('wb') as raw, gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as gz, tarfile.open(fileobj=gz,mode='w',dereference=True) as archive:
  for name in sorted(files):
   data=(root/name).read_bytes();info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o755 if os.access(root/name,os.X_OK) else 0o644;info.mtime=0
   archive.addfile(info,io.BytesIO(data))
  data=json.dumps(manifest,sort_keys=True).encode();info=tarfile.TarInfo('release.json');info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
 pathlib.Path(str(output)+'.sha256').write_text(digest(output)+'\n')
 pathlib.Path(str(output)+'.manifest.json').write_text(json.dumps(manifest,sort_keys=True))
 print(json.dumps({'commit':manifest['commit'],'tree':manifest['tree'],'sha256':digest(output),'files':len(files)}))
if __name__=='__main__':
 import sys
 build(pathlib.Path.cwd(),pathlib.Path(sys.argv[1]).resolve())
