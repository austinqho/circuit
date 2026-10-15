import {programHash} from '../analysis/library-program-bank.mjs';
import {portableImplementation,libraryImportSubpath} from './library-program-catalog.mjs';

/** A native export has no readable JavaScript implementation. An exact host
 * identity can supply a candidate from an existing interpreter primitive, but
 * never bypass the caller's independent behavior and integration checks. */
export async function admitHostIntrinsic({implementation,scope,bank}) {
  if(!scope)return {status:'frontier',stage:'checker',reason:'independent_input_domain_required',implementation};
  if(implementation.context.host_binding?.capability!=='array_brand'
    || implementation.producer!==Array.isArray || !implementation.unchanged())
    return {status:'frontier',stage:'source',reason:'host_intrinsic_identity_unverified'};
  const program={schema:'producttrace.library-program.v1',body:{op:'is_array',value:{op:'arg',index:0}}};
  const result=await bank.admit({implementation,program,scope});
  if(result.status!=='admitted')return {...result,origin:'host_intrinsic',implementation};
  const source=portableImplementation(implementation.context),hash=programHash(program);
  const subpath=libraryImportSubpath(implementation.context.specifier);
  return {...result,origin:'host_intrinsic',implementation,
    catalog_extension:{schema:'producttrace.library-program-catalog.v1',skeletons:[{
      schema:'producttrace.library-program-skeleton.v1',package:source.runtime.entry.name,
      export_name:source.export_name,...(subpath!=='.'?{import_subpath:subpath}:{}),program,scope,
      versions:[{version:source.runtime.entry.version,base_sha256:hash,overrides:[],program_sha256:hash,
        implementation_sha256:programHash(source),implementation:source,
        verification:{kind:'independent_host_intrinsic_recheck',report:result.report}}],
    }]},
  };
}
