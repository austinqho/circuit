# Runtime entry handlers missing from the static inventory

Gap count: 72.

Each row is the first depth-zero registered first-party handler reached by a dispatched event. Deeper frames and later depth-zero React work are excluded.

## client/src/components/Agents/AgentCard.tsx — click (1)

- `function:db93e50bb24ebd41cd8ed147a57a01aded367a0ae4a10cc8407a0dcad393eb44:1294:1396|click`; actions=action:mud5qu41:1; outcomes=action:mud5qu41:1:stop_with_reason

## client/src/components/Agents/AgentCard.tsx — keydown (1)

- `function:db93e50bb24ebd41cd8ed147a57a01aded367a0ae4a10cc8407a0dcad393eb44:2177:2330|keydown`; actions=action:mud5qsnz:4; outcomes=action:mud5qsnz:4:correct_stop

## client/src/components/Agents/AgentDetailContent.tsx — click (2)

- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:4041:4041|click`; actions=action:mud5qujm:2; outcomes=action:mud5qujm:2:reached_db
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:3072:3179|click`; actions=action:mud5quuq:3; outcomes=action:mud5quuq:3:correct_stop

## client/src/components/Agents/CategoryTabs.tsx — click (1)

- `function:03d99a9d5089e95c4ffa5a70cbbf4f5813fb77d5f745d3f6bf8116c6d10b452a:4781:4811|click`; actions=action:mud5qp5a:3, action:mud5qpgj:5; outcomes=action:mud5qp5a:3:reached_backend, action:mud5qpgj:5:stop_with_reason

## client/src/components/Agents/CategoryTabs.tsx — keydown (1)

- `function:03d99a9d5089e95c4ffa5a70cbbf4f5813fb77d5f745d3f6bf8116c6d10b452a:4836:4875|keydown`; actions=action:mud5qpgj:4; outcomes=action:mud5qpgj:4:correct_stop

## client/src/components/Agents/SearchBar.tsx — input (1)

- `function:af7a114f45953b092b7cbedc7633c433667bf18eabd982d79041ea3373ed401a:1680:1764|input`; actions=action:mud5qoy4:1, action:mud5qrl2:1; outcomes=action:mud5qoy4:1:stop_with_reason, action:mud5qrl2:1:reached_backend

## client/src/components/Auth/LoginForm.tsx — submit (1)

- `function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:4451:4518|submit`; actions=action:mud5esjd:6; outcomes=action:mud5esjd:6:reached_db

## client/src/components/Chat/AddMultiConvo.tsx — click (1)

- `function:5a012ee28cab752976b744f05623cfa6e53a271f372c69dbdb8f7a92595db1d2:741:1062|click`; actions=action:mud5ns5d:22; outcomes=action:mud5ns5d:22:correct_stop

## client/src/components/Chat/Input/ChatForm.tsx — change (1)

- `function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:6504:6548|change`; actions=action:mud5f9xd:7, action:mud5gux2:32, action:mud5hriv:5, action:mud5lurr:5; outcomes=action:mud5f9xd:7:stop_with_reason, action:mud5gux2:32:stop_with_reason, action:mud5hriv:5:stop_with_reason, action:mud5lurr:5:stop_with_reason

## client/src/components/Chat/Input/ChatForm.tsx — click (1)

- `function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:6238:6307|click`; actions=action:mud5oag9:23, action:mud5ov3o:26; outcomes=action:mud5oag9:23:stop_with_reason, action:mud5ov3o:26:correct_stop

## client/src/components/Chat/Input/ChatForm.tsx — keydown (1)

- `function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:23024:23389|keydown`; actions=action:mud5hqwg:1, action:mud5hqwn:2, action:mud5lu7t:1, action:mud5lu81:2, action:mud5mmyp:1, action:mud5mmyr:2, action:mud5onh2:24, action:mud5oqby:25, action:mud5p9su:1, action:mud5p9sx:2, action:mud5pfv0:1, action:mud5pfv4:2, action:mud5ps6r:1, action:mud5ps6u:2, action:mud5pyhi:1, action:mud5pyhk:2, action:mud5q1iq:1, action:mud5q1is:2, action:mud5q49y:1, action:mud5q4a0:2, action:mud5q7r2:2, action:mud5qfn0:2, action:mud5qi1d:1, action:mud5qi1e:2, action:mud5qo6z:1, action:mud5qo70:2, action:mud5qr1s:1, action:mud5qr1u:2, action:mud5qto7:1, action:mud5qto8:2, action:mud5qw8k:5; outcomes=action:mud5hqwg:1:stop_with_reason, action:mud5hqwn:2:stop_with_reason, action:mud5lu7t:1:stop_with_reason, action:mud5lu81:2:stop_with_reason, action:mud5mmyp:1:stop_with_reason, action:mud5mmyr:2:stop_with_reason, action:mud5onh2:24:correct_stop, action:mud5oqby:25:stop_with_reason, action:mud5p9su:1:stop_with_reason, action:mud5p9sx:2:stop_with_reason, action:mud5pfv0:1:stop_with_reason, action:mud5pfv4:2:stop_with_reason, action:mud5ps6r:1:stop_with_reason, action:mud5ps6u:2:stop_with_reason, action:mud5pyhi:1:stop_with_reason, action:mud5pyhk:2:stop_with_reason, action:mud5q1iq:1:stop_with_reason, action:mud5q1is:2:stop_with_reason, action:mud5q49y:1:stop_with_reason, action:mud5q4a0:2:stop_with_reason, action:mud5q7r2:2:stop_with_reason, action:mud5qfn0:2:stop_with_reason, action:mud5qi1d:1:stop_with_reason, action:mud5qi1e:2:stop_with_reason, action:mud5qo6z:1:stop_with_reason, action:mud5qo70:2:stop_with_reason, action:mud5qr1s:1:stop_with_reason, action:mud5qr1u:2:stop_with_reason, action:mud5qto7:1:stop_with_reason, action:mud5qto8:2:stop_with_reason, action:mud5qw8k:5:stop_with_reason

## client/src/components/Chat/Input/ChatForm.tsx — submit (1)

- `function:5bffa2fdd4c733f29915e45df0c96db29349642d734d468587e001d45b4495ac:17345:18011|submit`; actions=action:mud5f9zr:9, action:mud5guyc:34, action:mud5hrla:7, action:mud5luu3:7; outcomes=action:mud5f9zr:9:reached_db, action:mud5guyc:34:reached_db, action:mud5hrla:7:reached_db, action:mud5luu3:7:reached_db

## client/src/components/Chat/Input/QuoteButton.tsx — change (2)

- `function:75f32896411a3ab25642d745d3682ef5fd9a661d711ad25ea95b65f896af07f3:3921:4072|change`; actions=action:mud5f985:4, action:mud5gde9:25; outcomes=action:mud5f985:4:stop_with_reason, action:mud5gde9:25:stop_with_reason
- `function:75f32896411a3ab25642d745d3682ef5fd9a661d711ad25ea95b65f896af07f3:3289:3428|change`; actions=action:mud5gdh4:27, action:mud5jiet:6, action:mud5pc2w:8; outcomes=action:mud5gdh4:27:stop_with_reason, action:mud5jiet:6:stop_with_reason, action:mud5pc2w:8:stop_with_reason

## client/src/components/Chat/Input/QuoteButton.tsx — input (1)

- `function:75f32896411a3ab25642d745d3682ef5fd9a661d711ad25ea95b65f896af07f3:3921:4072|input`; actions=action:mud5ju6n:8, action:mud5kt8r:11; outcomes=action:mud5ju6n:8:stop_with_reason, action:mud5kt8r:11:stop_with_reason

## client/src/components/Chat/Menus/Endpoints/CustomMenu.tsx — click (1)

- `function:8f1603af0a00233afcc1e4fe75f9282402a11025ce765f29b53b4d9991dd3707:582:4211|click`; actions=action:mud5f8so:2, action:mud5f9f0:5; outcomes=action:mud5f8so:2:stop_with_reason, action:mud5f9f0:5:stop_with_reason

## client/src/components/Chat/Menus/Endpoints/ModelSelector.tsx — input (1)

- `function:bf83f5540c24ffabf10aa95c6f9fb73e01b4ede2e56c529901e2b09f279c9e5a:3203:3235|input`; actions=action:mud5f95p:3; outcomes=action:mud5f95p:3:stop_with_reason

## client/src/components/Chat/Messages/Content/EditMessage.tsx — input (1)

- `function:289ebfafc16db6ab1b7c43f3ad92ef1ef1bbc05f52d4aaad5105283f68e4ab40:4818:4898|input`; actions=action:mud5ft8s:9; outcomes=action:mud5ft8s:9:stop_with_reason

## client/src/components/Chat/Messages/Feedback.tsx — click (2)

- `function:b6e145fc35bd0ba6db55e49be03b3feca87fa96f6806ac5b0544ae8b6145c59c:3040:3236|click`; actions=action:mud5fku5:2; outcomes=action:mud5fku5:2:stop_with_reason
- `function:b6e145fc35bd0ba6db55e49be03b3feca87fa96f6806ac5b0544ae8b6145c59c:3347:3559|click`; actions=action:mud5fl8w:3; outcomes=action:mud5fl8w:3:reached_db

## client/src/components/Chat/Messages/HoverButtons.tsx — click (2)

- `function:650d204cb86c5d8d205f4f14a39f9465dd47b1595658212cd3961bb38b951241:5746:5746|click`; actions=action:mud5fki3:1; outcomes=action:mud5fki3:1:stop_with_reason
- `function:650d204cb86c5d8d205f4f14a39f9465dd47b1595658212cd3961bb38b951241:6446:6446|click`; actions=action:mud5ft2i:5; outcomes=action:mud5ft2i:5:stop_with_reason

## client/src/components/Chat/Messages/MessageNav.tsx — keydown (1)

- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:38461:38654|keydown`; actions=action:mud5ic0b:3; outcomes=action:mud5ic0b:3:reached_backend

## client/src/components/Conversations/Conversations.tsx — click (1)

- `function:c3157a7c2c41cf7836df40621b7304393c56cbd1b99632f5f2577a7f2940253c:15076:15118|click`; actions=action:mud5nhmh:20; outcomes=action:mud5nhmh:20:correct_stop

## client/src/components/Conversations/Convo.tsx — change (1)

- `function:5b55f6a2a632b9afc6d3bc3e813b83fb1556b6bc3227408982f251fdc0b467d7:3869:4156|change`; actions=action:mud5g1jh:15; outcomes=action:mud5g1jh:15:stop_with_reason

## client/src/components/Conversations/ConvoOptions/ConvoOptions.tsx — click (1)

- `function:3bba1791a3fdf183ba30c32c208c672d1070797fec38692102eb25c78f597bf8:13949:14037|click`; actions=action:mud5g0r7:12, action:mud5ha6x:36; outcomes=action:mud5g0r7:12:stop_with_reason, action:mud5ha6x:36:stop_with_reason

## client/src/components/Conversations/RenameForm.tsx — input (1)

- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1312:1348|input`; actions=action:mud5g1hb:14; outcomes=action:mud5g1hb:14:stop_with_reason

## client/src/components/Messages/ContentRender.tsx — click (1)

- `function:c057074eb90d959be20f9e8d7801624cfaa20e2e8d36fad2558178c65501d329:3465:3490|click`; actions=action:mud5fmhv:4, action:mud5g41z:17; outcomes=action:mud5fmhv:4:reached_db, action:mud5g41z:17:reached_db

## client/src/components/Nav/AccountSettings.tsx — click (3)

- `function:df29f4ea0c83a973c224841b8fca9ba62ba73000f16ea03d539c375f7cbc6502:6886:6913|click`; actions=action:mud5mnfx:4, action:mud5pa4a:4, action:mud5pg8a:4, action:mud5psgq:4, action:mud5pyos:4, action:mud5q1qx:4; outcomes=action:mud5mnfx:4:stop_with_reason, action:mud5pa4a:4:stop_with_reason, action:mud5pg8a:4:stop_with_reason, action:mud5psgq:4:stop_with_reason, action:mud5pyos:4:stop_with_reason, action:mud5q1qx:4:stop_with_reason
- `function:df29f4ea0c83a973c224841b8fca9ba62ba73000f16ea03d539c375f7cbc6502:6351:6385|click`; actions=action:mud5q4t2:4; outcomes=action:mud5q4t2:4:stop_with_reason
- `function:df29f4ea0c83a973c224841b8fca9ba62ba73000f16ea03d539c375f7cbc6502:6430:6454|click`; actions=action:mud5q87p:4, action:mud5qcga:4; outcomes=action:mud5q87p:4:stop_with_reason, action:mud5qcga:4:stop_with_reason

## client/src/components/Nav/ExportConversation/ExportModal.tsx — input (1)

- `function:4ac1a744b830c9e393d8fdef5075b1e86ece267b519511820c697196010ecdcc:3166:3206|input`; actions=action:mud5iywu:5; outcomes=action:mud5iywu:5:stop_with_reason

## client/src/components/Nav/Favorites/FavoriteItem.tsx — click (1)

- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:6304:6402|click`; actions=action:mud5mtbs:12, action:mud5muw5:13, action:mud5mwc2:15; outcomes=action:mud5mtbs:12:correct_stop, action:mud5muw5:13:correct_stop, action:mud5mwc2:15:stop_with_reason

## client/src/components/Nav/Favorites/FavoriteItem.tsx — keydown (1)

- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:6429:6608|keydown`; actions=action:mud5mwbz:14, action:mud5n7nc:17, action:mud5naq8:18; outcomes=action:mud5mwbz:14:correct_stop, action:mud5n7nc:17:correct_stop, action:mud5naq8:18:stop_with_reason

## client/src/components/Nav/Settings/Dialog.tsx — click (1)

- `function:0c3ef91a3513ec70f6f479eb289181d6c012977888d8f536d28b6bfde1f87be4:3936:3961|click`; actions=action:mud5movg:6; outcomes=action:mud5movg:6:correct_stop

## client/src/components/Nav/Settings/Sidebar.tsx — click (1)

- `function:7e6774488daa285c8b009f4e9e0ae5fa9cee14c107ed3180f6030ce06f0a42a8:2443:2468|click`; actions=action:mud5moax:5, action:mud5pau6:5, action:mud5pcml:9, action:mud5pgym:5, action:mud5psvn:5, action:mud5pz31:5, action:mud5q24s:5; outcomes=action:mud5moax:5:stop_with_reason, action:mud5pau6:5:stop_with_reason, action:mud5pcml:9:correct_stop, action:mud5pgym:5:stop_with_reason, action:mud5psvn:5:stop_with_reason, action:mud5pz31:5:stop_with_reason, action:mud5q24s:5:stop_with_reason

## client/src/components/Nav/Settings/Sidebar.tsx — input (1)

- `function:7e6774488daa285c8b009f4e9e0ae5fa9cee14c107ed3180f6030ce06f0a42a8:1063:1099|input`; actions=action:mud5pbff:6; outcomes=action:mud5pbff:6:stop_with_reason

## client/src/components/Nav/SettingsTabs/Account/TwoFactorAuthentication.tsx — click (1)

- `function:016c3500233f00d2e762e03a917ccb98971369817aa7461de405ca784e4a5582:6746:6771|click`; actions=action:mud5pzji:6; outcomes=action:mud5pzji:6:correct_stop

## client/src/components/Nav/SettingsTabs/Data/SharedLinks.tsx — click (1)

- `function:c1151672c0e3174325c1a4fc2f57efabd89ca4974fde5ce82f0adc017b1fb766:10365:10386|click`; actions=action:mud5pua6:8; outcomes=action:mud5pua6:8:reached_backend

## client/src/components/Nav/SettingsTabs/Speech/STT/DecibelSelector.tsx — click (1)

- `function:4ebbd9edd45cb8a6e113eef6a0a2871c62ee455413957c6930d25f5a710221da:1068:1094|click`; actions=action:mud5piqa:7; outcomes=action:mud5piqa:7:stop_with_reason

## client/src/components/Nav/SettingsTabs/Speech/TTS/PlaybackRate.tsx — click (1)

- `function:55a11d721ab6e23291dc88c1ca40c207e0574776150ae9f0467cb37067873c17:1060:1087|click`; actions=action:mud5pmbl:9; outcomes=action:mud5pmbl:9:stop_with_reason

## client/src/components/Prompts/fields/CategorySelector.tsx — click (1)

- `function:e499ba34414a7b1c0b384d30481a48894dde2121246f3141a81dc600427245fd:2890:2914|click`; actions=action:mud5qiqa:4; outcomes=action:mud5qiqa:4:correct_stop

## client/src/components/Prompts/fields/Command.tsx — input (1)

- `function:ca5cca825c8c376313f9cbb6a3f748c95cb76b251a2f136186becd7366d45b6b:863:1125|input`; actions=action:mud5qldp:8; outcomes=action:mud5qldp:8:stop_with_reason

## client/src/components/Prompts/fields/Description.tsx — input (1)

- `function:0a1067aed04de7c54a7fd211df470518455c0ae818d724e8935a9d58af7d9841:852:994|input`; actions=action:mud5qkzs:6; outcomes=action:mud5qkzs:6:stop_with_reason

## client/src/components/SidePanel/Agents/AgentConfig.tsx — input (1)

- `function:03e1cb3bc038e969913a678f7dba70299865e9d83f2601d7e4a8a558aec974db:2609:3446|input`; actions=action:mud5gdbu:24; outcomes=action:mud5gdbu:24:stop_with_reason

## client/src/components/SidePanel/Agents/AgentConfig.tsx — submit (1)

- `function:03e1cb3bc038e969913a678f7dba70299865e9d83f2601d7e4a8a558aec974db:8299:8402|submit`; actions=action:mud5gdh4:29; outcomes=action:mud5gdh4:29:reached_db

## client/src/components/SidePanel/Agents/AgentPanel.tsx — click (1)

- `function:8d743139e77d92b28cd8136781b34251ae924d248459cafcdbca5688fb1bab76:16793:16902|click`; actions=action:mud5gu46:30; outcomes=action:mud5gu46:30:reached_backend

## client/src/components/UnifiedSidebar/ExpandedPanel.tsx — click (2)

- `function:55cdfa4e9b9cd76a31a8abb6ec207cca6b3a91d5252491d7cc409c80c6eb2272:1369:1734|click`; actions=action:mud5f8gs:1, action:mud5hr39:3, action:mud5lug5:3; outcomes=action:mud5f8gs:1:stop_with_reason, action:mud5hr39:3:reached_backend, action:mud5lug5:3:reached_backend
- `function:55cdfa4e9b9cd76a31a8abb6ec207cca6b3a91d5252491d7cc409c80c6eb2272:2699:3019|click`; actions=action:mud5g4ve:18, action:mud5gbgw:19, action:mud5h9f4:35, action:mud5qfwn:3, action:mud5qi1t:3, action:mud5qmwu:4; outcomes=action:mud5g4ve:18:stop_with_reason, action:mud5gbgw:19:reached_backend, action:mud5h9f4:35:reached_backend, action:mud5qfwn:3:reached_backend, action:mud5qi1t:3:stop_with_reason, action:mud5qmwu:4:stop_with_reason

## client/src/components/UnifiedSidebar/UnifiedSidebar.tsx — click (1)

- `function:37698d9b8cce400d0c26fcb80e77d4cf4c246b60fc1d663c2a9f25811631569d:2338:2376|click`; actions=action:mud5qmqt:1; outcomes=action:mud5qmqt:1:stop_with_reason

## client/src/data-provider/Endpoints/queries.ts — click (1)

- `function:f09318d8e0718d6657a3b4aa6d8224466a83a3757cf387ccc2cf55e198999fcf:1929:2078|click`; actions=action:mud5q2l8:6; outcomes=action:mud5q2l8:6:correct_stop

## client/src/hooks/AuthContext.tsx — input (1)

- `function:d426904881477deab5ac54d2a98468aa2a47c85fd20c26e19a8cbb2357ecfb8c:9424:9605|input`; actions=action:mud5gdea:26; outcomes=action:mud5gdea:26:stop_with_reason

## client/src/hooks/Chat/useGetAddedConvo.ts — click (1)

- `function:331fd4345137cbf1b7c01850c3999c382577bbec382335994fe42dd9a8b4616b:308:413|click`; actions=action:mud5ftaa:11; outcomes=action:mud5ftaa:11:reached_db

## client/src/hooks/Conversations/useExportConversation.ts — click (1)

- `function:f3ca1ec21bed3d066e426b81b087cdc15f5a9f47561438dc58a35f2496710024:8611:8611|click`; actions=action:mud5jiet:7, action:mud5kddz:9, action:mud5ld2q:12; outcomes=action:mud5jiet:7:reached_request, action:mud5kddz:9:correct_stop, action:mud5ld2q:12:correct_stop

## client/src/hooks/Input/useAutoSave.ts — input (1)

- `function:33a9763db82db8f7c78e3a35d68af3766502e776ded837e64454a7f3f1254f61:4745:5213|input`; actions=action:mud5f9to:6, action:mud5guvl:31, action:mud5hrcn:4, action:mud5lup9:4; outcomes=action:mud5f9to:6:stop_with_reason, action:mud5guvl:31:stop_with_reason, action:mud5hrcn:4:stop_with_reason, action:mud5lup9:4:stop_with_reason

## client/src/hooks/Messages/useMemoizedChatContext.ts — change (1)

- `function:26049ed0174c7ccfea71e985f00ce21907cdca7207f38100812e244f1199274e:2309:2377|change`; actions=action:mud5ft8w:10; outcomes=action:mud5ft8w:10:stop_with_reason

## client/src/hooks/Messages/useMemoizedChatContext.ts — click (1)

- `function:26049ed0174c7ccfea71e985f00ce21907cdca7207f38100812e244f1199274e:2309:2377|click`; actions=action:mud5ft8k:6; outcomes=action:mud5ft8k:6:stop_with_reason

## client/src/hooks/Messages/useMessageScrolling.ts — keydown (1)

- `function:dc38a923ef12eaf4ea45d3f0214840e9770867e144210c5a2b43c9235ef7c91d:3590:3653|keydown`; actions=action:mud5ft8n:7, action:mud5ft8o:8; outcomes=action:mud5ft8n:7:stop_with_reason, action:mud5ft8o:8:stop_with_reason

## client/src/hooks/useKeyboardShortcuts.ts — keydown (1)

- `function:da3bcfbab834fa61e5dd6cc39365bfd3256757b226487308ddd8861fd6da274b:31929:33286|keydown`; actions=action:mud5q7o1:1, action:mud5qbr0:1, action:mud5qbro:2, action:mud5qfk9:1; outcomes=action:mud5q7o1:1:stop_with_reason, action:mud5qbr0:1:stop_with_reason, action:mud5qbro:2:reached_backend, action:mud5qfk9:1:stop_with_reason

## client/src/hooks/useLocalize.ts — click (1)

- `function:7461216d5c1f1e563770681bcd7b69cf96bc98afd90d852dc81cf2f47abafff0:341:414|click`; actions=action:mud5i60p:1, action:mud5m90h:1; outcomes=action:mud5i60p:1:stop_with_reason, action:mud5m90h:1:stop_with_reason

## client/src/Providers/AnnouncerContext.tsx — click (1)

- `function:d9ef4cf59b38b17bf3f53d7a5804f35a04cbd99d98a49c6d992b09335a1f7f6f:590:681|click`; actions=action:mud5gcsb:22; outcomes=action:mud5gcsb:22:stop_with_reason

## client/src/utils/messages.ts — click (1)

- `function:2092a88d65eab3c07fffbd5782da62d7dcc1f4abd782201429d5f9e976473add:8782:9228|click`; actions=action:mud5qv4h:4; outcomes=action:mud5qv4h:4:reached_backend

## packages/client/dist/index.mjs — click (1)

- `function:c0169f7950996fe2f5e8e81025ad13e25b144fbdb2b6c2c96b93c2af58c0b4b2:272815:273643|click`; actions=action:mud5gchy:21; outcomes=action:mud5gchy:21:stop_with_reason

## packages/client/src/components/DropdownPopup.tsx — click (1)

- `function:1ea515b6ccf6f7cdaa309ee977af745b491d84055bd0d553ee76f79c5e35eb91:4872:5157|click`; actions=action:mud5g1cs:13, action:mud5haq2:37, action:mud5i6gf:2, action:mud5m9gp:2, action:mud5qkjy:5; outcomes=action:mud5g1cs:13:stop_with_reason, action:mud5haq2:37:stop_with_reason, action:mud5i6gf:2:stop_with_reason, action:mud5m9gp:2:stop_with_reason, action:mud5qkjy:5:correct_stop

## packages/client/src/components/OGDialogTemplate.tsx — click (1)

- `function:11fd26a3609a3c0d79db7bd2b3843c8dd08803aa3fa7a96835f2911d323c4b80:3549:3575|click`; actions=action:mud5ikjv:4, action:mud5khqy:10; outcomes=action:mud5ikjv:4:correct_stop, action:mud5khqy:10:correct_stop

## packages/client/src/components/SplitText.tsx — click (1)

- `function:aa747ac5c293f96a642845dd67c24bb4e92f71c481f2d12070a92b31a9cc94e8:2291:2543|click`; actions=action:mud5mn04:3, action:mud5p9u1:3, action:mud5pfw9:3, action:mud5ps7n:3, action:mud5pyi9:3, action:mud5q1jj:3, action:mud5q4ar:3, action:mud5q81e:3, action:mud5qc8r:3; outcomes=action:mud5mn04:3:stop_with_reason, action:mud5p9u1:3:stop_with_reason, action:mud5pfw9:3:stop_with_reason, action:mud5ps7n:3:stop_with_reason, action:mud5pyi9:3:stop_with_reason, action:mud5q1jj:3:stop_with_reason, action:mud5q4ar:3:stop_with_reason, action:mud5q81e:3:stop_with_reason, action:mud5qc8r:3:stop_with_reason

## packages/client/src/components/Tooltip.tsx — keydown (2)

- `function:8535bff87ea3c3f5bdeedf1ed964e0c4b059dd66bd32012506fecb5c72760e29:4356:4713|keydown`; actions=action:mud5mpc9:7, action:mud5q8qt:5, action:mud5qmwo:2, action:mud5qmwp:3; outcomes=action:mud5mpc9:7:stop_with_reason, action:mud5q8qt:5:correct_stop, action:mud5qmwo:2:stop_with_reason, action:mud5qmwp:3:stop_with_reason
- `function:8535bff87ea3c3f5bdeedf1ed964e0c4b059dd66bd32012506fecb5c72760e29:962:979|keydown`; actions=action:mud5q935:6, action:mud5q9kn:7; outcomes=action:mud5q935:6:stop_with_reason, action:mud5q9kn:7:correct_stop

## packages/client/src/hooks/useInputModality.ts — click (1)

- `function:3c08149a2f85d32fe0470634de19a4c328e835489fd6a7779ce41a0560ce6e6f:302:350|click`; actions=action:mud5piq9:6, action:mud5pmbl:8; outcomes=action:mud5piq9:6:stop_with_reason, action:mud5pmbl:8:stop_with_reason

## packages/client/src/hooks/useInputModality.ts — input (1)

- `function:3c08149a2f85d32fe0470634de19a4c328e835489fd6a7779ce41a0560ce6e6f:302:350|input`; actions=action:mud5esid:3; outcomes=action:mud5esid:3:stop_with_reason

## packages/client/src/Providers/ToastContext.tsx — keydown (1)

- `function:088ad4ecf982bdde80aa1f2c6d9b160fa9949afe11b354f6038fba284aa49c2e:425:515|keydown`; actions=action:mud5n0ar:16; outcomes=action:mud5n0ar:16:stop_with_reason

