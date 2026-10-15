import {readLibraryImplementation} from './library-implementation.mjs';
import {readCatalogImplementation,portableImplementation,admitCatalogProgram,libraryImportSubpath} from './library-program-catalog.mjs';
import {authorLibraryProgram} from './library-program-author.mjs';
import {verifyCatalogCompatibility} from './library-program-compatibility.mjs';
import {admitHostIntrinsic} from './library-program-intrinsics.mjs';
import {programHash} from '../analysis/library-program-bank.mjs';

/** Resolve an encountered import through the reusable bank or a bounded author.
 * The caller owns the independent checker and any spending-wrapped provider.
 * No provider means no model request. A bank miss never grants a rule, and
 * catalog answers are never included in a missing-function proposal context. */
export async function resolveLibraryProgram({repository,specifier,exportName,catalogs=[],bank,
  scope,provider,mode='bank_first',compatibility='reject',maxAttempts=3,onAttempt,previousProposal,expectedImplementationSha256}) {
  if(!['bank_first','unfamiliar_only'].includes(mode))throw new TypeError('library_resolution_mode');
  if(!['reject','verify'].includes(compatibility))throw new TypeError('library_compatibility_mode');
  if(!bank||typeof bank.admit!=='function'||typeof bank.lookup!=='function')throw new TypeError('independent_bank_required');
  let implementation;
  try{implementation=readLibraryImplementation({repository,specifier,exportName});}
  catch(error){return {status:'frontier',stage:'source',reason:'implementation_resolution_failed',detail:String(error.message).slice(0,300)};}
  if(expectedImplementationSha256&&implementation.sha256!==expectedImplementationSha256)
    return {status:'frontier',stage:'source',reason:'frozen_implementation_changed'};
  let miss='catalog_bypassed_for_unfamiliar_evaluation';
  if(mode==='bank_first'){
    const cached=bank.lookup(specifier,exportName);
    if(cached){
      if(cached.producer!==implementation.producer)return {status:'frontier',stage:'bank',reason:'bank_repository_or_runtime_conflict'};
      return {status:'admitted',origin:'live_bank',id:cached.id,implementation};
    }
    if(!Array.isArray(catalogs)||catalogs.length>128)return {status:'frontier',stage:'catalog',reason:'catalog_list_shape'};
    const skeletons=[];
    for(const catalog of catalogs){
      if(catalog?.schema!=='producttrace.library-program-catalog.v1'||!Array.isArray(catalog.skeletons))
        return {status:'frontier',stage:'catalog',reason:'catalog_schema'};
      skeletons.push(...catalog.skeletons);
    }
    if(skeletons.length>10000)return {status:'frontier',stage:'catalog',reason:'catalog_size_limit'};
    const primary=portableImplementation(implementation.context);
    const sameExport=skeletons.filter(row=>row?.package===primary.runtime.entry.name&&row.export_name===exportName&&(row.import_subpath??'.')===libraryImportSubpath(specifier));
    const sameVersion=sameExport.filter(row=>Array.isArray(row.versions)&&row.versions.some(item=>item.version===primary.runtime.entry.version));
    miss=!sameExport.length?'catalog_entry_missing':!sameVersion.length?'catalog_version_unverified':'catalog_source_unverified';
    const matches=[];
    for(const skeleton of sameVersion){
      let candidate=implementation;
      try{if(skeleton.host_dependencies?.length)candidate=readCatalogImplementation({repository,specifier,exportName,skeleton});}
      catch{continue;}
      const hash=programHash(portableImplementation(candidate.context));
      const versions=skeleton.versions.filter(row=>row.version===primary.runtime.entry.version);
      if(versions.length!==1)return {status:'frontier',stage:'catalog',reason:'ambiguous_catalog_version'};
      const variants=versions[0].source_variants??versions;
      if(!Array.isArray(variants))return {status:'frontier',stage:'catalog',reason:'source_variant_shape'};
      if(variants.some(row=>row.implementation_sha256===hash))matches.push({skeleton,implementation:candidate});
    }
    // Select before admission so two conflicting entries cannot leave the
    // live bank populated with whichever candidate happened to run first.
    if(matches.length>1)return {status:'frontier',stage:'catalog',reason:'ambiguous_catalog_entry'};
    if(matches.length===1){
      const result=await admitCatalogProgram({...matches[0],bank});
      return {...result,origin:'catalog',implementation:matches[0].implementation};
    }
    if(implementation.context.host_binding?.capability==='array_brand')
      return admitHostIntrinsic({implementation,scope,bank});
    if(compatibility==='verify'&&sameExport.length)
      return verifyCatalogCompatibility({repository,specifier,exportName,skeletons:sameExport,bank});
  }
  if(!provider)return {status:'frontier',stage:'catalog',reason:miss,implementation};
  if(!scope)return {status:'frontier',stage:'checker',reason:'independent_input_domain_required',implementation};
  // Only fresh source and caller-declared capabilities reach authoring. A
  // failed, stale or adjacent bank program is not a proposed answer template.
  const result=await authorLibraryProgram({implementation,scope,provider,bank,maxAttempts,onAttempt,previousProposal});
  return {...result,origin:'authoring',bank_miss:miss,implementation};
}
