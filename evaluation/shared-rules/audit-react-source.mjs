import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readLibraryImplementation} from '../../authoring/library-implementation.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const inventory=JSON.parse(fs.readFileSync(path.join(directory,'react-public-inventory.json')));
const repository=path.join(directory,'react-runtime/18');
const rows=[];
for(const row of inventory.rows){
  try{
    const implementation=readLibraryImplementation({repository,specifier:row.surface,exportName:row.export_name});
    rows.push({id:row.id,surface:row.surface,export_name:row.export_name,
      source_status:implementation.context.source_status,source_reason:implementation.context.source_reason,
      installed_packages:implementation.context.packages.map(({name,version})=>({name,version})),
      implementation_sha256:implementation.sha256,selected_declarations:implementation.context.slices.length,
      selected_bytes:implementation.context.slices.reduce((n,r)=>n+Buffer.byteLength(r.source),0),
      runtime_implementation:implementation.context.implementation,
      outcome:'source_audit_only_not_admitted'});
  }catch(error){rows.push({id:row.id,surface:row.surface,export_name:row.export_name,source_status:'frontier',source_reason:error.message,outcome:'source_audit_only_not_admitted'});}
}
const counts={};for(const row of rows){const key=row.source_status==='ready_for_scoped_proposal'?'loaded_export_source_ready':row.source_reason==='export_not_callable'?'non_callable_public_export':'source_frontier';counts[key]=(counts[key]||0)+1;}
const report={inventory_rows:inventory.rows.length,inventory_sha256:createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
  scope:'Node/CommonJS development export-source audit against exact React/ReactDOM 18.3.1. Loaded wrapper source is not renderer dispatch resolution, behavior verification or usable rule admission. Non-callable markers require export-value handling, not a fabricated callable implementation.',counts,model_requests:0,rows};
fs.writeFileSync(path.join(directory,'react-source-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({inventory_rows:report.inventory_rows,counts,model_requests:0}));
