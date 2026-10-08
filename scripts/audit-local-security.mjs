// Read-only repository audit. Reports locations/categories, never matched values.
import {readFileSync,existsSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
const root=process.cwd();
const git=spawnSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8',windowsHide:true});
if(git.status!==0)throw Error('Git inventory unavailable');
const files=[...new Set(git.stdout.split('\0').filter(Boolean))];
const secretFindings=[],modules=new Map(),guardInventory=[];
const patterns=[['API key',/\b(?:sk-proj-|sk-(?:live|test)_|sb_secret_)[A-Za-z0-9_-]{20,}/g],['credential URI',/\bpostgres(?:ql)?:\/\/[^\s'"<>]+:[^\s'"<>]+@[^\s'"<>]+/g],['OAuth refresh token',/\b1\/\/[A-Za-z0-9_-]{40,}/g],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]];
for(const file of files){const path=resolve(root,file);if(!existsSync(path)||!statSync(path).isFile()||statSync(path).size>2000000)continue;
 // .env.example is the only env file allowed, and only with variable NAMES (empty values) and comments.
 const namesOnlyExample=file==='.env.example'&&readFileSync(path,'utf8').split(/\r?\n/).every(line=>/^\s*(#.*)?$/.test(line)||/^[A-Z][A-Z0-9_]*=$/.test(line));
 if(!namesOnlyExample&&(/(?:^|\/)\.env(?:\.|$)|\.(?:dump|backup|pem|p12)$/i.test(file)||file.startsWith('backups/')))secretFindings.push({file,category:'Sensitive artifact eligible for Git'});
 if(!/\.(?:[cm]?[jt]sx?|json|md|sql|ps1|toml|ya?ml)$/.test(file))continue;
 const text=readFileSync(path,'utf8');
 text.split(/\r?\n/).forEach((line,index)=>{for(const [category,pattern] of patterns){pattern.lastIndex=0;for(const hit of line.matchAll(pattern))if(!/fixture|placeholder|example|xxx|fake|local-validation|127\.0\.0\.1|password@host|user:password/i.test(hit[0]))secretFindings.push({file,line:index+1,category});}});
 if(!/^(?:lib|app|components)\/.*\.tsx?$/.test(file)&&file!=='proxy.ts')continue;
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),imports=[];let client=false,serverAction=false,serverOnly=false;
 for(const s of ast.statements){if(ts.isExpressionStatement(s)&&ts.isStringLiteral(s.expression)){client||=s.expression.text==='use client';serverAction||=s.expression.text==='use server';}
  if(ts.isImportDeclaration(s)&&ts.isStringLiteral(s.moduleSpecifier)&&!s.importClause?.isTypeOnly){const name=s.moduleSpecifier.text;if(name==='server-only')serverOnly=true;
   if(name.startsWith('@/')||name.startsWith('.')){const target=name.startsWith('@/')?resolve(root,name.slice(2)):resolve(dirname(path),name);for(const suffix of ['.ts','.tsx','/index.ts','/index.tsx'])if(existsSync(target+suffix)){imports.push(relative(root,target+suffix).replaceAll('\\','/'));break;}}
  }
 }
 modules.set(file,{imports,client,serverAction,serverOnly,privileged:/getSupabaseServerClient|SUPABASE_SECRET_KEY|OPENAI_API_KEY|GOOGLE_DRIVE_CLIENT_SECRET|GOOGLE_DRIVE_REFRESH_TOKEN/.test(text)});
 if(serverAction)for(const s of ast.statements)if(ts.isFunctionDeclaration(s)&&s.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))guardInventory.push({file,fn:s.name?.text,directAdminGuard:/await\s+requireAdmin\(/.test(s.getText(ast))});
}
const boundaryFindings=[];
for(const [file,m] of modules)if(m.client){const visited=new Set();const visit=(name,chain)=>{if(visited.has(name))return;visited.add(name);const child=modules.get(name);if(!child||child.serverAction)return;if(child.serverOnly||child.privileged)boundaryFindings.push({client:file,server:name,chain});for(const target of child.imports)visit(target,[...chain,target]);};visit(file,[file]);}
const tracked=spawnSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'ls-files','-z'],{encoding:'utf8',windowsHide:true}).stdout.split('\0').filter(Boolean);
const sensitiveTracked=tracked.filter(f=>/(?:^|\/)\.env(?:\.|$)|\.(?:dump|backup|pem|p12)$|^backups\//i.test(f));
const report={filesEligibleForGit:files.length,applicationModules:modules.size,clientComponents:[...modules.values()].filter(m=>m.client).length,serverActions:guardInventory,secretFindings,boundaryFindings,sensitiveTracked};
mkdirSync(resolve(root,'.local'),{recursive:true});writeFileSync(resolve(root,'.local/security-audit.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({filesEligibleForGit:files.length,applicationModules:modules.size,clientComponents:report.clientComponents,serverActions:guardInventory.length,actionsWithoutDirectGuard:guardInventory.filter(a=>!a.directAdminGuard),secretFindings,boundaryFindings,sensitiveTracked},null,2));
if(secretFindings.length||boundaryFindings.length||sensitiveTracked.length)process.exitCode=1;
