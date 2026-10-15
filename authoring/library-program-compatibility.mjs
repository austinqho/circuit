import {normalizeLibraryProgram} from './library-program-normalize.mjs';
import {programHash,resolveVersionedProgram} from '../analysis/library-program-bank.mjs';
import {readCatalogImplementation,portableImplementation,libraryImportSubpath} from './library-program-catalog.mjs';

/** Existing rules are candidates for a new installation, never compatibility
 * assertions. Compare a small, explicit set without populating the live bank;
 * then admit only one independently verified program and scope. No model is
 * involved and the returned catalog extension still requires re-admission. */
export async function verifyCatalogCompatibility({repository,specifier,exportName,skeletons,bank}) {
  const frontier=(reason,extra={})=>({status:'frontier',stage:'compatibility',reason,...extra});
  if(typeof bank.verify!=='function')return frontier('side_effect_free_verification_required');
  const candidates=new Map();let examined=0;
  for(const skeleton of skeletons){
    if(skeleton.export_name!==exportName||(skeleton.import_subpath??'.')!==libraryImportSubpath(specifier))return frontier('catalog_import_subpath_mismatch');
    if(!Array.isArray(skeleton.versions))return frontier('catalog_version_shape');
    const versions=new Set();
    for(const row of skeleton.versions){
      if(versions.has(row.version))return frontier('ambiguous_catalog_version');
      versions.add(row.version);
      const base=resolveVersionedProgram(skeleton,row.version);
      if(base.status!=='resolved_program')return frontier(base.reason);
      const variants=row.source_variants??[row];
      if(!Array.isArray(variants)||!variants.length)return frontier('source_variant_shape');
      for(const variant of variants){
        if(++examined>128)return frontier('compatibility_source_candidate_limit');
        let resolved=base;
        if(row.source_variants)resolved=resolveVersionedProgram({schema:skeleton.schema,program:base.program,versions:[{
          version:row.version,base_sha256:base.sha256,overrides:variant.overrides,
        }]},row.version);
        if(resolved.status!=='resolved_program')return frontier(resolved.reason);
        if(variant.program_sha256!==resolved.sha256)return frontier('catalog_program_changed');
        if(typeof variant.implementation_sha256!=='string'||!variant.implementation_sha256.length)
          return frontier('catalog_source_identity_missing');
        const scope=variant.scope??row.scope??skeleton.scope;
        const hosts=skeleton.host_dependencies??[];
        const normalized=normalizeLibraryProgram(resolved.program);
        if(normalized.status!=='normalized')return frontier(normalized.reason);
        const identity=programHash({program:normalized.program,scope,hosts});
        const origin={version:row.version,implementation_sha256:variant.implementation_sha256,program_sha256:resolved.sha256,normalization:normalized.rewrites};
        if(candidates.has(identity))candidates.get(identity).origins.push(origin);
        else candidates.set(identity,{skeleton,program:normalized.program,scope,origins:[origin]});
        if(candidates.size>4)return frontier('compatibility_program_candidate_limit');
      }
    }
  }
  const attempts=[],passed=[];
  for(const candidate of candidates.values()){
    let implementation;
    try{implementation=readCatalogImplementation({repository,specifier,exportName,skeleton:candidate.skeleton});}
    catch(error){return frontier('compatibility_source_resolution_failed',{detail:String(error.message).slice(0,300),attempts});}
    if(candidate.skeleton.package!==portableImplementation(implementation.context).runtime.entry.name)return frontier('catalog_export_mismatch');
    let result;
    try{result=await bank.verify({implementation,program:candidate.program,scope:candidate.scope});}
    catch(error){return frontier('compatibility_checker_failed',{detail:String(error.message).slice(0,300),attempts});}
    attempts.push({origins:candidate.origins,...result});
    if(result.status==='verified')passed.push({...candidate,implementation});
    // A source/checker failure cannot safely be treated as a disproved rule
    // when selecting between alternatives. Stop before admission or spending.
    else if(result.stage==='source'||result.reason==='checker_failure')return frontier('compatibility_verification_incomplete',{attempts});
  }
  if(passed.length!==1)return frontier(passed.length?'ambiguous_compatible_rules':'no_verified_compatible_rule',{attempts});
  const selected=passed[0];
  const admission=await bank.admit({implementation:selected.implementation,program:selected.program,scope:selected.scope});
  if(admission.status!=='admitted')return {...admission,attempts};
  const source=portableImplementation(selected.implementation.context),hash=programHash(selected.program);
  return {...admission,origin:'verified_compatibility',implementation:selected.implementation,attempts,
    catalog_extension:{schema:'producttrace.library-program-catalog.v1',skeletons:[{
      schema:'producttrace.library-program-skeleton.v1',package:source.runtime.entry.name,export_name:exportName,
      ...(libraryImportSubpath(specifier)!=='.'?{import_subpath:libraryImportSubpath(specifier)}:{}),
      program:selected.program,scope:selected.scope,
      ...(selected.skeleton.host_dependencies?{host_dependencies:structuredClone(selected.skeleton.host_dependencies)}:{}),
      versions:[{version:source.runtime.entry.version,base_sha256:hash,overrides:[],program_sha256:hash,
        implementation_sha256:programHash(source),implementation:source,
        verification:{kind:'independent_version_recheck',origins:selected.origins,report:admission.report}}],
    }]},
  };
}
