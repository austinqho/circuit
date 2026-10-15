const contracts = [
  {
    id: 'tanstack-react-query/useInfiniteQuery.fetchNextPage/4.36.1',
    package: '@tanstack/react-query',
    versions: ['4.36.1'],
    producer: 'useInfiniteQuery',
    returned_member: 'fetchNextPage',
    invokes_option: 'queryFn',
    option_argument: 0,
    callback_timing: 'may_begin_synchronously',
    callback_argument_object: ['queryKey', 'pageParam', 'meta', 'signal'],
    condition: 'a possible callback; a newly admitted fetch can invoke queryFn before fetchNextPage returns, while retries and completion are asynchronous; cancellation, reuse of an in-flight fetch, or an undefined computed next-page parameter with existing pages can prevent a new invocation',
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-y7ySVHFyyQblPl3J3eQBWpXZkliroki3ARnBKsdJchlgt7yJLRDUcf4B8soufgiYt3pEQIkBWBx1N9/ZPIeUWw==',
      installations: [
        {
          package: '@tanstack/react-query',
          version: '4.36.1',
          integrity: 'sha512-y7ySVHFyyQblPl3J3eQBWpXZkliroki3ARnBKsdJchlgt7yJLRDUcf4B8soufgiYt3pEQIkBWBx1N9/ZPIeUWw==',
          files: {
            'package.json': '70c486013df0ba1ade0cc475f5a94b2baa4401b58d9ae1b347274f6e61db80a5',
            'build/lib/index.mjs': '68aff6aa611454cf2b64cfa5652207d8cf4d704b42d6d4b4296f3f3ccedc0cc5',
            'build/lib/useInfiniteQuery.mjs': 'ff88f00daf092063ee1d60ca73360108730e90fea8299d8cc7f792712f3e886b',
            'build/lib/useBaseQuery.mjs': '2d46f0da9633909d493743a609f9c8e60484bdca7f624394b1a315c1950a6c96',
          },
        },
        {
          package: '@tanstack/query-core',
          version: '4.36.1',
          integrity: 'sha512-DJSilV5+ytBP1FbFcEJovv4rnnm/CokuVvrBEtW/Va9DvuJ3HksbXUJEpI0aV1KtuL4ZoO9AVE6PyNLzF7tLeA==',
          files: {
            'package.json': '39e2bf758978d2779ed7a463fa8d477b3bff34ed63f34ce0dfbff905efa46c0e',
            'build/lib/index.mjs': '97226559bc9388e5a85a13ed749b111d8869dc84fedd8fd0cc73da43de6ef640',
            'build/lib/infiniteQueryObserver.mjs': '55d455601e4362a7fc8a27cd1b404e1d4d550246b32e6b2243025dedc6dde5c1',
            'build/lib/infiniteQueryBehavior.mjs': '42284c88dfdb8b7e65fdb1e1aaf8996d45503f038df6c2d100dbe83655b26805',
            'build/lib/query.mjs': 'a169d3eea71d74036972553493e9a4e6b78591c8ccf354620a4d77bec77d9d1e',
          },
        },
      ],
    },
  },
  {
    id: 'recoil/useRecoilCallback.returnedCallback/0.7.7',
    kind: 'factory_returns_callback',
    package: 'recoil',
    versions: ['0.7.7'],
    producer: 'useRecoilCallback',
    factory_argument: 0,
    callback_timing: 'factory_and_callback_begin_synchronously',
    callback_argument_forwarding: 'all',
    condition: 'each invocation calls this useRecoilCallback occurrence\'s factory with a fresh Recoil callback interface, then immediately invokes only the function returned by that factory; a returned promise settles asynchronously',
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-8Og5KPQW9LwC577Vc7Ug2P0vQshkv1y3zG3tSSkWMqkWSwHmE+by06L8JtnGocjW6gcCvfwB3YtrJG6/tWivNQ==',
      installations: [
        {
          package: 'recoil',
          version: '0.7.7',
          integrity: 'sha512-8Og5KPQW9LwC577Vc7Ug2P0vQshkv1y3zG3tSSkWMqkWSwHmE+by06L8JtnGocjW6gcCvfwB3YtrJG6/tWivNQ==',
          files: {
            'package.json': 'c6a92c3dab48cf70bbfdece64bb7375e5bcf991b573682c1cfed6db037867b25',
            'cjs/index.js': '2a9d73ad3197d660f9966509b12fdf490904d98cbcab56e46b31e5354431a4ca',
          },
        },
      ],
    },
  },
  {
    id: 'react-hook-form/useForm.handleSubmit/7.50.0',
    kind: 'returned_member_returns_callback',
    package: 'react-hook-form',
    versions: ['7.50.0'],
    producer: 'useForm',
    returned_member: 'handleSubmit',
    callback_arguments: [
      { argument: 0, branch: 'valid', required: true, callback_argument_object: ['formValues', 'event'] },
      { argument: 1, branch: 'invalid', required: false, callback_argument_object: ['formErrors', 'event'] },
    ],
    callback_timing: 'after_asynchronous_validation',
    condition: 'the returned submit handler prevents the native event, validates this form instance, then awaits onValid for an empty error set or onInvalid for a nonempty error set; the two callbacks are mutually exclusive for one submission',
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-AOhuzM3RdP09ZCnq+Z0yvKGHK25yiOX5phwxjV9L7U6HMla10ezkBnvQ+Pk4GTuDfsC5P2zza3k8mawFwFLVuQ==',
      installations: [
        {
          package: 'react-hook-form',
          version: '7.50.0',
          integrity: 'sha512-AOhuzM3RdP09ZCnq+Z0yvKGHK25yiOX5phwxjV9L7U6HMla10ezkBnvQ+Pk4GTuDfsC5P2zza3k8mawFwFLVuQ==',
          files: {
            'package.json': '97f697c9be78ba1204f6b9cd9c3619014b8dc2e22fa6eca8679d526e8c05e3d8',
            'dist/index.esm.mjs': '4c49bd264e37eec9284d30fb9e3c15bdb418087a477c6e73212fed714ac397a9',
          },
        },
      ],
    },
  },
  {
    id: 'react-router-dom/useNavigate.navigation/7.18.2',
    kind: 'returned_function_effect',
    package: 'react-router-dom',
    versions: ['7.18.2'],
    producer: 'useNavigate',
    effect: 'navigation',
    target_argument: 0,
    options_argument: 1,
    effect_timing: 'synchronous_dispatch_when_router_is_active',
    condition: 'after the router layout effect activates this hook instance, a numeric target calls history.go(delta); any other target resolves a location and synchronously calls this router instance\'s push or replace method according to options.replace',
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-AIKJ/jgGlFb3EbfCXk5Gzshiwt+l3mqbCrNjmEWMMjqQxNJ3svBa6bgzFyCC2Sw3RA0VWF1kg3uQf2OFhxb8hw==',
      installations: [
        {
          package: 'react-router-dom', version: '7.18.2',
          integrity: 'sha512-AIKJ/jgGlFb3EbfCXk5Gzshiwt+l3mqbCrNjmEWMMjqQxNJ3svBa6bgzFyCC2Sw3RA0VWF1kg3uQf2OFhxb8hw==',
          files: {
            'package.json': '5ad7d08fe2baef8d629449eaaa9cd90d2e86b68712a8a4dc6ae5305fb2bd90bd',
            'dist/index.mjs': '546ba7c63847e42d0be74d277f9ee1793e2a4a742e564f76b1a29fce13a94331',
          },
        },
        {
          package: 'react-router', version: '7.18.2',
          integrity: 'sha512-aUVMjFm3GAPTTZL7oYr5E7ETiqfQCHRLH+B+5afnICvf0r7kkK4eR6SMuwbSTJw/7t+12khT/Kahij49fqOCIg==',
          files: {
            'package.json': '74e8abc9b1048398bf95899eae32c7d365bc23640330bb763de7e2d0cf86e2f3',
            'dist/development/index.mjs': 'f25529bcec70481bb5e0511d1c5dc1752931769ea9e1f419dd9aa92faa395a81',
            'dist/development/chunk-62JRHF6Z.mjs': 'dd66635c4b1d3fe3b81e1183735db79e0dd0525e7acad8b9a787ef00c94bc007',
          },
        },
      ],
    },
  },
  ...[
    { component: 'MenuButton', callback_prop: 'onClick', activation_event: 'click',
      condition: 'the rendered menu button invokes its own onClick prop synchronously before Ariakit applies menu state changes; preventDefault can stop the later internal action' },
    { component: 'MenuItem', callback_prop: 'onClick', activation_event: 'click',
      condition: 'the rendered menu item invokes its own onClick prop synchronously before Ariakit may hide the menu; preventDefault, downloads, new-tab activation, submenus, and hideOnClick can prevent hiding without changing callback ownership' },
    { component: 'MenuItemCheckbox', callback_prop: 'onChange', activation_event: 'click',
      condition: 'the non-native menuitemcheckbox click path synchronously invokes only its own onChange prop unless disabled, an earlier click handler prevents default, or activation does not reach the checkbox change path' },
  ].map(spec => ({
    id: `ariakit/${spec.component}.${spec.activation_event}->${spec.callback_prop}/0.4.29`,
    kind: 'component_event', package: '@ariakit/react', versions: ['0.4.29'],
    producer: spec.component, callback_prop: spec.callback_prop,
    activation_event: spec.activation_event, callback_argument_forwarding: 'all',
    callback_timing: 'synchronous_during_activation', forwards_children: true,
    condition: spec.condition,
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-SLXlsddWHSwfUol4Yi0zULlalNWjzWjpS3zg7B7aaPd64saONQ5ktWf9KMxqBklcpjMLeF2dB9BAHAvpPVdCIQ==',
      installations: [
        { package: '@ariakit/react', version: '0.4.29',
          integrity: 'sha512-SLXlsddWHSwfUol4Yi0zULlalNWjzWjpS3zg7B7aaPd64saONQ5ktWf9KMxqBklcpjMLeF2dB9BAHAvpPVdCIQ==',
          files: { 'package.json': '44995c1eeb7e80dd73edeec9fada273d7d245906ba807d7db8bd9295e93d79e1',
            'esm/index.js': '68d0911db8709b0d0f6163578a2ba88bf8c49fce5541d15095ee452c0bd25c41',
            'esm/menu.js': 'a7f20b2ce5c78c221242186f131dd7a3e66bf03d184931c4d3ed205466149e8e' } },
        { package: '@ariakit/react-components', version: '0.1.2',
          integrity: 'sha512-SM+SPMAVlOZmGAfWNBza+0k9y4mkA5/dJhDoOyhE96cbNARy665uLdwowSJl1JGuFfcZzuzAwGon7f/rYeyfkQ==',
          files: { 'package.json': '69c061c85e6cb20e4554bb7063678d921f016070cb3a2e24d6063d0c1b876ccd',
            'dist/index.js': 'c03ace33c9e71c1f429c6c59b0a8fffa9af892ad7ad038ba56e1b6ff0d133264',
            ...(spec.component === 'MenuButton' ? { 'dist/menu/menu-button.js': '07b45f727040728c587fa98fd761d18cc84a2a644b0eb0141e2d189d5659fc82' }
              : spec.component === 'MenuItem' ? { 'dist/menu/menu-item.js': 'bdcf62369ae012df19f49fd70af9d5644c0226b0460d4b6f2b7848dc47a466fa' }
              : { 'dist/menu/menu-item-checkbox.js': 'cfdf1d525d9f49333e35a154f8cba628c99047cbd2b08a1240f5260f6677ab99',
                'dist/checkbox/checkbox.js': '3ae92510533a0bd02e0ea80a2c8c522a59f075e4747a8b8923ee4c59b25476c6' }) } },
      ],
    },
  })),
  {
    id: '@tanstack/react-table/flexRender.component/8.11.7',
    kind: 'function_renders_argument',
    package: '@tanstack/react-table',
    versions: ['8.11.7'],
    producer: 'flexRender',
    render_argument: 0,
    props_argument: 1,
    render_timing: 'synchronous_during_react_render',
    condition: 'when the first argument is a class, function, memo, or forwardRef React component, flexRender creates that exact component with the second argument as its props; a missing component yields null and a non-component value is returned unchanged',
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-ZbzfMkLjxUTzNPBXJYH38pv2VpC9WUA+Qe5USSHEBz0dysDTv4z/ARI3csOed/5gmlmrPzVUN3UXGuUMbod3Jg==',
      installations: [
        {
          package: '@tanstack/react-table', version: '8.11.7',
          integrity: 'sha512-ZbzfMkLjxUTzNPBXJYH38pv2VpC9WUA+Qe5USSHEBz0dysDTv4z/ARI3csOed/5gmlmrPzVUN3UXGuUMbod3Jg==',
          files: {
            'package.json': '111a658eeb789dc11cd91a1a6d4343bc4dfad01fc90137c63d7aeaece863d888',
            'build/lib/index.mjs': '532d92888a7b1484a75b62246e302247a5aeecb395a71dfc69bdc57cbd8cf5b9',
          },
        },
        {
          package: '@tanstack/table-core', version: '8.11.7',
          integrity: 'sha512-N3ksnkbPbsF3PjubuZCB/etTqvctpXWRHIXTmYfJFnhynQKjeZu8BCuHvdlLPpumKbA+bjY4Ay9AELYLOXPWBg==',
          files: {
            'package.json': '1ff61c259d36d0b8e3c6bcaecd119ba4d4926c6239e17947fa6cddb0871483c5',
            'build/lib/index.mjs': '1a6d12fba4950857f7bdefdead4054c9c7b5a1784c680857b165e4ebdca73180',
          },
        },
      ],
    },
  },
  ...[
    ['get', 'GET', null, 1], ['delete', 'DELETE', null, 1],
    ['post', 'POST', 1, 2], ['put', 'PUT', 1, 2], ['patch', 'PATCH', 1, 2],
  ].map(([producer, method, bodyArgument, optionsArgument]) => ({
    id: `axios/${producer}.httpRequest/1.18.1`,
    kind: 'direct_function_effect',
    package: 'axios', versions: ['1.18.1'], producer,
    effect: 'http_request', method, url_argument: 0,
    ...(bodyArgument == null ? {} : { body_argument: bodyArgument }),
    options_argument: optionsArgument,
    effect_timing: 'request_dispatch_returns_promise',
    condition: `calling the default Axios instance's ${producer} method merges configuration and may dispatch a ${method} request through the selected adapter; request interceptors, base URL configuration, transforms, or cancellation can alter or prevent the eventual runtime request`,
    verification: {
      method: 'real_package_fixture',
      package_integrity: 'sha512-3nTvFlvpn9Zu/RkHUqtc7/+al4UpRW5az71ap5zccp6e8RAYEzhMTecX8Dz1wWDYrPpUoB1HAQEGEAEvUr7S9g==',
      installations: [{
        package: 'axios', version: '1.18.1',
        integrity: 'sha512-3nTvFlvpn9Zu/RkHUqtc7/+al4UpRW5az71ap5zccp6e8RAYEzhMTecX8Dz1wWDYrPpUoB1HAQEGEAEvUr7S9g==',
        files: {
          'package.json': '65f1d1513135840ca721900a56995a6fea13dc124c41a0873389ad4ac64c052e',
          'index.js': '42286a158ea8dc6244e7e985b7c195d4f0ba25b97c9250305e604928f851378c',
          'lib/axios.js': '1ee4dce4ce982228f2980aa4573a496464a8afd5f866592a47000b3ae25cd49b',
          'lib/core/Axios.js': 'f1fa07ebded26cec3cab518e054ae18439c0312276b13f5e78287c274cd8c481',
          'lib/core/dispatchRequest.js': 'fca1cc4b1709fe2e96c77abbf2cfae27df8df936ab01a614fc10547fe09df794',
          'lib/adapters/adapters.js': '2d3df49937264cb77ddfae5121bfb15f606b6b8d74582da4691bca983fc81a5d',
        },
      }],
    },
  })),
];

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export const VERIFIED_LIBRARY_CONTRACTS = freeze(contracts);

export function libraryContractPackages() {
  return [...new Set(VERIFIED_LIBRARY_CONTRACTS.map(contract => contract.package))].sort();
}

export function contractsForPackageVersion(packageName, version) {
  return VERIFIED_LIBRARY_CONTRACTS.filter(contract => contract.package === packageName
    && contract.versions.includes(version));
}

export function matchLibraryContract({ packageName, version, producer, returnedMember }) {
  return VERIFIED_LIBRARY_CONTRACTS.find(contract => contract.package === packageName
    && contract.versions.includes(version)
    && contract.producer === producer
    && contract.returned_member === returnedMember) || null;
}

export function producerContracts({ packageName, version, producer, kind }) {
  return VERIFIED_LIBRARY_CONTRACTS.filter(contract => contract.package === packageName
    && contract.versions.includes(version)
    && contract.producer === producer
    && (!kind || contract.kind === kind));
}
