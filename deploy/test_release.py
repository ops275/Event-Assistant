import contextlib, hashlib, importlib.util, io, json, os, pathlib, tarfile, tempfile, unittest
spec=importlib.util.spec_from_file_location("release",pathlib.Path(__file__).with_name("release.py"))
r=importlib.util.module_from_spec(spec); spec.loader.exec_module(r)

class ReleaseTests(unittest.TestCase):
 def test_unsafe_archive_members(self):
  for name in ["../etc/passwd","/etc/passwd","bot/../../x","bot/.env","bot/data/state.json","node_modules/x/../../../etc/x","bot/credentials.json","bot/private/a","bot/test/fixture.json"]:
   with self.subTest(name=name), self.assertRaises(ValueError): r.validate_path(name)
  self.assertEqual(r.validate_path("bot/index.js"),"bot/index.js")
  self.assertEqual(r.validate_path("node_modules/dotenv/lib/main.js"),"node_modules/dotenv/lib/main.js")
 def test_archive_rejects_symlinks_and_unmanifested_files(self):
  with tempfile.TemporaryDirectory() as d:
   dest=pathlib.Path(d)/"dest"; archive=pathlib.Path(d)/"a.tar.gz"
   with tarfile.open(archive,"w:gz") as t:
    m=tarfile.TarInfo("bot/index.js");m.type=tarfile.SYMTYPE;m.linkname="/etc/shadow";t.addfile(m)
   with self.assertRaises(ValueError):r.unpack(archive,dest)
 def test_manifest_hash_and_complete_membership(self):
  for corrupt,extra in [(False,False),(True,False),(False,True)]:
   with self.subTest(corrupt=corrupt,extra=extra),tempfile.TemporaryDirectory() as d:
    archive=pathlib.Path(d)/"a.tar.gz"; data=b"safe"
    manifest={"commit":"a"*40,"tree":"b"*40,"files":{"bot/index.js":hashlib.sha256(data).hexdigest()}}
    with tarfile.open(archive,"w:gz") as t:
     for name,content in [("release.json",json.dumps(manifest).encode()),("bot/index.js",b"bad" if corrupt else data)]+([("bot/extra.js",b"extra")] if extra else []):
      m=tarfile.TarInfo(name);m.size=len(content);t.addfile(m,io.BytesIO(content))
    if corrupt or extra:
     with self.assertRaises(ValueError):r.unpack(archive,pathlib.Path(d)/"out")
    else:self.assertEqual(r.unpack(archive,pathlib.Path(d)/"out")["tree"],"b"*40)
 def test_production_gate_matches_exact_tree_archive_and_acceptance(self):
  good={"tree":"a"*40,"archive":"b"*64,"healthy":True,"accepted":True}
  r.require_receipt(good,"a"*40,"b"*64)
  for bad in [{**good,"tree":"c"*40},{**good,"archive":"c"*64},{**good,"healthy":False},{**good,"accepted":False}]:
   with self.subTest(bad=bad),self.assertRaises(ValueError):r.require_receipt(bad,"a"*40,"b"*64)
 def test_plan_preserves_unmanaged_data_detects_drift_and_deletions(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/"bot").mkdir();(p/"bot/index.js").write_text("old");(p/"bot/state.json").write_text("private")
   baseline={"bot/index.js":r.digest(p/"bot/index.js")}
   self.assertEqual(r.plan(p,baseline,{"bot/index.js":"new","bot/new.js":"new"}),["bot/index.js","bot/new.js"])
   with self.assertRaises(ValueError):r.plan(p,baseline,{})
   (p/"bot/index.js").write_text("unexpected")
   with self.assertRaises(ValueError):r.plan(p,baseline,{"bot/index.js":"new"})
   self.assertEqual((p/"bot/state.json").read_text(),"private")
 def test_symlink_target_rejected_and_affected_workers_bounded(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/"bot").symlink_to(p,target_is_directory=True)
   with self.assertRaises(ValueError):r.safe_target(p,"bot/index.js")
  self.assertEqual(r.affected(["bot/index.js"]),["onlyplay-bot"])
  self.assertEqual(r.affected(["calendar-web/calendar-web.mjs"]),["onlyplay-web","onlyplay-onboarding","onlyplay-reminders"])
  self.assertEqual(r.affected(["README.md"]),[])
  self.assertEqual(len(r.affected(["package-lock.json"])),5)
 def test_production_failure_restores_changed_files_and_preserves_data(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d)/"live";backup=pathlib.Path(d)/"backup";root.mkdir();(root/"bot").mkdir();(backup/"files/bot").mkdir(parents=True)
   (root/"bot/index.js").write_text("bad-candidate");(backup/"files/bot/index.js").write_text("previous");(root/"bot/state.json").write_text("new-live-record")
   (root/"bot/new.js").write_text("added")
   calls=[]
   with patch.object(r,"run",side_effect=lambda *a:calls.append(a)),patch.object(r,"health"),patch.object(r,"identity"),patch.object(r,"pm2"):
    r.restore(root,backup,{"changes":["bot/index.js","bot/new.js"],"workers":["onlyplay-bot"]})
   self.assertEqual((root/"bot/index.js").read_text(),"previous");self.assertFalse((root/"bot/new.js").exists())
   self.assertEqual((root/"bot/state.json").read_text(),"new-live-record")
   self.assertEqual(calls,[("pm2","restart","onlyplay-bot")])
 def test_unmanaged_source_collision_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/"package.json").write_text("unmanaged")
   with self.assertRaises(ValueError):r.plan(p,{}, {"package.json":"candidate"})
 def test_shared_followup_module_restarts_onboarding(self):
  self.assertEqual(r.affected(["bot/services/followupTemplates.js"]),["onlyplay-bot","onlyplay-onboarding"])
 def make_artifact(self,archive):
  files={"bot/index.js":b"candidate","node_modules/pkg/index.js":b"candidate-dependency"}
  manifest={"commit":"a"*40,"tree":"b"*40,"files":{p:hashlib.sha256(v).hexdigest() for p,v in files.items()}}
  with tarfile.open(archive,"w:gz") as t:
   for name,content in list(files.items())+[("release.json",json.dumps(manifest).encode())]:
    m=tarfile.TarInfo(name);m.size=len(content);t.addfile(m,io.BytesIO(content))
  return manifest
 def test_first_staging_failure_can_retry_identical_release(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as d:
   base=pathlib.Path(d);stage=base/"stage";state=base/"state";(stage/"releases/old").mkdir(parents=True)
   for x in ("receipts","artifacts","backups"):(state/x).mkdir(parents=True)
   (stage/"current").symlink_to(stage/"releases/old",target_is_directory=True)
   archive=base/"a.tar.gz";m=self.make_artifact(archive);sha=r.digest(archive)
   def windows_link(path,target):
    path.unlink(missing_ok=True);path.symlink_to(target,target_is_directory=True)
   link_patch=patch.object(r,"link",side_effect=windows_link) if os.name=="nt" else contextlib.nullcontext()
   with link_patch,patch.object(r,"STAGE",stage),patch.object(r,"STATE",state),patch.object(r,"identity"),patch.object(r,"run"),patch.object(r,"pm2",return_value={"onlyplay-bot":1}),patch.object(r,"health",side_effect=[ValueError("unhealthy"),None]):
    with patch.object(r.sys,"stdin",SimpleNamespace(buffer=io.BytesIO(archive.read_bytes()))),self.assertRaises(ValueError):r.stage(m["commit"],m["tree"],sha)
    self.assertEqual((stage/"current").resolve(),stage/"releases/old")
    with patch.object(r.sys,"stdin",SimpleNamespace(buffer=io.BytesIO(archive.read_bytes()))):r.stage(m["commit"],m["tree"],sha)
   self.assertTrue(r.read(state/"receipts"/(m["tree"]+".json"))["healthy"])
 def test_promotion_failure_rolls_back_then_success_promotes_exact_artifact(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   base=pathlib.Path(d);root=base/"live";state=base/"state";(root/"bot").mkdir(parents=True);(root/"node_modules/pkg").mkdir(parents=True)
   for x in ("receipts","artifacts","backups"):(state/x).mkdir(parents=True)
   (root/"bot/index.js").write_text("previous");(root/"node_modules/pkg/index.js").write_text("previous-dependency");(root/"bot/live-record.json").write_text("new-live-data")
   archive=state/"artifacts"/("b"*40+".tar.gz");m=self.make_artifact(archive)
   r.write(state/"receipts"/(m["tree"]+".json"),{"tree":m["tree"],"archive":r.digest(archive),"healthy":True,"accepted":True})
   r.write(state/"production-baseline.json",{"root":str(root),"files":{"bot/index.js":r.digest(root/"bot/index.js")},"dependency_hash":r.installed_dependencies(root)})
   with patch.object(r,"PROD",root),patch.object(r,"STATE",state),patch.object(r,"identity"),patch.object(r,"run"),patch.object(r,"pm2",return_value={w:1 for w in r.WORKERS}),patch.object(r,"private_hashes",return_value={}),patch.object(r,"health",side_effect=[ValueError("bad-candidate"),None,None]):
    with self.assertRaises(ValueError):r.promote(m["tree"])
    self.assertEqual((root/"bot/index.js").read_text(),"previous");self.assertEqual((root/"node_modules/pkg/index.js").read_text(),"previous-dependency")
    self.assertEqual((root/"bot/live-record.json").read_text(),"new-live-data")
    r.promote(m["tree"])
   self.assertEqual((root/"bot/index.js").read_text(),"candidate");self.assertEqual((root/"node_modules/pkg/index.js").read_text(),"candidate-dependency")
   self.assertEqual(r.read(state/"production.json")["commit"],m["commit"])
 def test_oidc_requires_github_signature_repo_branch_event_commit_and_tree(self):
  import base64,time
  from cryptography.hazmat.primitives.asymmetric import rsa,padding
  from cryptography.hazmat.primitives import hashes
  from unittest.mock import patch
  key=rsa.generate_private_key(public_exponent=65537,key_size=2048);pub=key.public_key().public_numbers()
  def b64(x):return base64.urlsafe_b64encode(x).decode().rstrip("=")
  jwk={"kid":"test","kty":"RSA","n":b64(pub.n.to_bytes(256,"big")),"e":b64(pub.e.to_bytes(3,"big"))}
  good={"iss":"https://token.actions.githubusercontent.com","aud":"qooob-deploy","repository":"ops275/Event-Assistant","repository_id":"1440183136","ref":"refs/heads/staging","event_name":"push","sha":"a"*40,"workflow_ref":"ops275/Event-Assistant/.github/workflows/check.yml@refs/heads/staging","exp":int(time.time())+300,"nbf":int(time.time())-5,"iat":int(time.time())-5}
  def token(claims):
   msg=b64(json.dumps({"alg":"RS256","kid":"test"}).encode())+"."+b64(json.dumps(claims).encode())
   return msg+"."+b64(key.sign(msg.encode(),padding.PKCS1v15(),hashes.SHA256()))
  with patch.object(r,"oidc_keys",return_value={"keys":[jwk]}),patch.object(r,"github_tree",return_value="b"*40):
   r.verify_oidc(token(good),"staging","a"*40,"b"*40)
   production={**good,"ref":"refs/heads/main","workflow_ref":"ops275/Event-Assistant/.github/workflows/check.yml@refs/heads/main","sha":"c"*40}
   r.verify_oidc(token(production),"production",tree="b"*40)
   for change in [{"ref":"refs/heads/feature/hack"},{"repository":"evil/repo"},{"repository_id":"1"},{"event_name":"pull_request"},{"exp":int(time.time())-60},{"aud":"other"},{"sha":"c"*40},{"workflow_ref":"ops275/Event-Assistant/.github/workflows/evil.yml@refs/heads/staging"}]:
    with self.subTest(change=change),self.assertRaises(ValueError):r.verify_oidc(token({**good,**change}),"staging","a"*40,"b"*40)
   with self.assertRaises(ValueError):r.verify_oidc(token(good),"production",tree="b"*40)
   with self.assertRaises(ValueError):r.verify_oidc(token(good),"staging","a"*40,"c"*40)
   broken=token(good);broken=broken[:-4]+"AAAA"
   with self.assertRaises(ValueError):r.verify_oidc(broken,"staging","a"*40,"b"*40)
if __name__=="__main__":unittest.main()
