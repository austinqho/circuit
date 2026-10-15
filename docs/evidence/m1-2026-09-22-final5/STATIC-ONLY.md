# Static-only function identities

Before: intersection=168; static-only=173.
After: intersection=280; static-only=61.

Reasons describe why the served transform manifest did not contain the analyzer identity.

## Before registration fixes (173)

### client/src/components/Agents/AgentDetailContent.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:1270:1341` 1270:1341 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:1428:2674` 1428:2674 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:2764:3185` 2764:3185 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Agents/SearchBar.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:af7a114f45953b092b7cbedc7633c433667bf18eabd982d79041ea3373ed401a:1680:1764` 1680:1764 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Agents/VirtualizedAgentGrid.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:d622f227b9eef88918b0d0a62420924e4bad180be878bfd2e36495f690e30c79:6684:6699` 6684:6699 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Artifacts/DownloadArtifact.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:ffc59f8eebf951ab5b669798c20b9f962c42efa526acab9e74f9085048d274d1:2946:3512` 2946:3512 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Auth/LoginForm.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3043:3197` 3043:3197 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3870:3894` 3870:3894 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Auth/Registration.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:5f6c35ceae5defb4d92a988b52eef18913e34d37a17b0864a9a56520bad36700:5864:5962` 5864:5962 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Auth/RequestPasswordReset.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:b061f811a3e788bf9d7d8f70a25603c5b25fc8e18f42cfb3d49c480ad20d16e3:1832:2705` 1832:2705 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Auth/ResetPassword.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:59f5b8ad054afc4866962d49bff8b17e072f6a57f04eec6f8b5fcad75b1428e9:1808:2060` 1808:2060 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Auth/TwoFactorScreen.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:e3df304f749403c6918bdc7a03561d820f898c65ceef1398c840d8bdd8da99ff:1870:2219` 1870:2219 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Banners/Banner.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:b6203e7c6f63c62a1b89738edb0ee3d46da7a537b3572805f67d5b41ce801ed5:1352:1533` 1352:1533 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Bookmarks/BookmarkForm.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:b83cb0b266b107d513faa1f082c075403054dda09effd18c98fb34989ea4de14:1806:2646` 1806:2646 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/BadgeRow.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:0fc897faba6aa1c96b626d96d2d1505ea324da5bc198d355ba7316277246279b:1999:2037` 1999:2037 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/Files/FileUpload.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:6b26e620c0d92d1630684e9fd7d45ba2a037600280430b72cbc88d215675ddd2:1761:1912` 1761:1912 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:6b26e620c0d92d1630684e9fd7d45ba2a037600280430b72cbc88d215675ddd2:852:1454` 852:1454 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/Files/ImagePreview.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:3593:3695` 3593:3695 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:6100:6126` 6100:6126 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/Files/Table/DataTable.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:aeaa664c02350056256c95a0c8902c7de3e72de3ffd118573dfd77e09756a54a:3879:3953` 3879:3953 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/Mention.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c6d4b08f53d65c3368352a0618b16f23cccee2b6fb13d77930225059e4c5225d:5702:7148` 5702:7148 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:c6d4b08f53d65c3368352a0618b16f23cccee2b6fb13d77930225059e4c5225d:7170:7207` 7170:7207 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/QuoteButton.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:75f32896411a3ab25642d745d3682ef5fd9a661d711ad25ea95b65f896af07f3:6492:6517` 6492:6517 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/SkillsCommand.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:dbfb380b58a6fada0f65c796d99249511ad79f02c8f7ad71c8681dcba2083054:10605:10642` 10605:10642 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:dbfb380b58a6fada0f65c796d99249511ad79f02c8f7ad71c8681dcba2083054:9267:10583` 9267:10583 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:be196c2c5396dd96f98d4106df67757ce972ca9651141e1da49b362a340a89fe:1310:1493` 1310:1493 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:be196c2c5396dd96f98d4106df67757ce972ca9651141e1da49b362a340a89fe:1520:1810` 1520:1810 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/AskUserQuestion.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:bfc4c9499f98a4aab7d563d89d39dc13dfd1dafb5eafe80e43abf817ad5d8af2:3494:3940` 3494:3940 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/DialogImage.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:10284:10310` 10284:10310 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:11765:11791` 11765:11791 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:4074:4293` 4074:4293 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/Parts/EditTextPart.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:bba5136fd85b15d10aedc0ed1461750b045200aea515cb8f244f1096faacdeee:2137:2927` 2137:2927 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:bba5136fd85b15d10aedc0ed1461750b045200aea515cb8f244f1096faacdeee:2954:3786` 2954:3786 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8c03949d40e9fd06eba1a1a27e2aba7608959fe59c89c84401021602c7d6ed99:2227:2330` 2227:2330 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8c03949d40e9fd06eba1a1a27e2aba7608959fe59c89c84401021602c7d6ed99:2451:2579` 2451:2579 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/Parts/Summary.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:1b3b6981d2bdc48e22d885cec52744240382dca70e094a51b339fbf08bfb5318:8042:8170` 8042:8170 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/Parts/Thinking.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:0f137964e79d4fce63a5490e15f25ebab7bb2a200a8417a950818069eb8248b6:1751:1993` 1751:1993 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:0f137964e79d4fce63a5490e15f25ebab7bb2a200a8417a950818069eb8248b6:8775:8903` 8775:8903 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/MessageNav.tsx (6)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:18270:20046` 18270:20046 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:24002:24070` 24002:24070 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:24137:24334` 24137:24334 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:26855:27369` 26855:27369 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:27441:27676` 27441:27676 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:7335:7408` 7335:7408 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/SearchButtons.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:266ed5994412e263969373eccdb859fe7b2d7aea6404ed2fc2f31615cc32bce2:844:1644` 844:1644 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Conversations/Convo.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:5b55f6a2a632b9afc6d3bc3e813b83fb1556b6bc3227408982f251fdc0b467d7:3869:4156` 3869:4156 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:5b55f6a2a632b9afc6d3bc3e813b83fb1556b6bc3227408982f251fdc0b467d7:7805:7965` 7805:7965 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:5b55f6a2a632b9afc6d3bc3e813b83fb1556b6bc3227408982f251fdc0b467d7:7984:8249` 7984:8249 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Conversations/ConvoOptions/ConvoOptions.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:3bba1791a3fdf183ba30c32c208c672d1070797fec38692102eb25c78f597bf8:5423:5889` 5423:5889 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Conversations/ConvoOptions/ProjectButton.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:6ad4d60b462e8d5ab6368aca90724f6d80d601743f7ce2da87de4aa8c4a9c2f6:1697:2344` 1697:2344 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:6ad4d60b462e8d5ab6368aca90724f6d80d601743f7ce2da87de4aa8c4a9c2f6:2799:2850` 2799:2850 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Conversations/RenameForm.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1312:1348` 1312:1348 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:671:897` 671:897 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Endpoints/Settings/Google.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c56932cefdf32a5a5abf2055cd8e066ddedf9ce35400995b10babe088faef4cf:2688:2732` 2688:2732 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Files/FileDashboardView.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:0475bb72f9319e08d00ae3af4c702d3b512b61f78f37a0bb4e7fb28b8fd90055:587:638` 587:638 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/DataTableFile.tsx (6)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:10285:10307` 10285:10307 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:3051:3112` 3051:3112 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:3202:3520` 3202:3520 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:5422:5496` 5422:5496 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:5640:5666` 5640:5666 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:9995:10021` 9995:10021 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FileListItem.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:8e925481b2035a3cc0de6c4fb5e41440d25d6d0adb47c15754600b963fe8f92e:1038:1064` 1038:1064 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FileListItem2.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:56dc297e78b3a4fb1a73954ad68a143f1196dccb7dcf48736ae456d4c9b7c25d:2418:2444` 2418:2444 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:56dc297e78b3a4fb1a73954ad68a143f1196dccb7dcf48736ae456d4c9b7c25d:564:615` 564:615 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FilePreview.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:c32a085d693ec0b4b1e2903b72e473277ddb63c6ac4872af4b1f544d2a0c5634:2256:2317` 2256:2317 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:c32a085d693ec0b4b1e2903b72e473277ddb63c6ac4872af4b1f544d2a0c5634:2438:2499` 2438:2499 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FileSidePanel.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:0c255a81fd40d0536a91a5cb819a482b5157383bdf1fd8aab23e866f1260a933:3666:3725` 3666:3725 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:0c255a81fd40d0536a91a5cb819a482b5157383bdf1fd8aab23e866f1260a933:3921:3979` 3921:3979 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FilesListView.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:e1ad42af472e990080e15f6da3d2bd1246d046837fad6a6764e288e4bd545b64:769:826` 769:826 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FilesSectionSelector.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:00a5704415faedb561f3dd76ae63d1d714935005b7e7bd2a5dab52fac5025879:1307:1397` 1307:1397 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:00a5704415faedb561f3dd76ae63d1d714935005b7e7bd2a5dab52fac5025879:925:1031` 925:1031 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStore/VectorStoreListItem.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:5c4e2864dd5d55fa6b501df1b4379fc6527ce6617a01d95716825341dc0845d1:1679:1719` 1679:1719 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:5c4e2864dd5d55fa6b501df1b4379fc6527ce6617a01d95716825341dc0845d1:547:596` 547:596 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStore/VectorStorePreview.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:945f9a87afab4bd2681e9d7d88a89e6832ec51471a72618225da7e298013c0d2:2909:2970` 2909:2970 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:945f9a87afab4bd2681e9d7d88a89e6832ec51471a72618225da7e298013c0d2:3073:3127` 3073:3127 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStore/VectorStoreSidePanel.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:900d70774a3b22f4536464db0fc09395340e359e12b9c4a1f45120a9727cd12d:4766:4829` 4766:4829 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:900d70774a3b22f4536464db0fc09395340e359e12b9c4a1f45120a9727cd12d:5038:5110` 5038:5110 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStoreView.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:4d4db847787857822a18476b1eea9415d9bd918a895b659e683f67a7b76410e3:679:740` 679:740 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/MCP/CustomUserVarsSection.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:0efbfb1c1bd3cdf2db8b18846e78e6f2fa2c669f9d6b0c921758c7a9b331e794:4933:4990` 4933:4990 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:0efbfb1c1bd3cdf2db8b18846e78e6f2fa2c669f9d6b0c921758c7a9b331e794:5021:5061` 5021:5061 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/MCP/MCPServerMenuItem.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:570ff7265315f3f4420f41c015cdbfe87410eaf348512f9d1888a1707a4e61a0:3408:3434` 3408:3434 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Messages/Content/CodeBlock.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:93c361dd3a778b7c329bd2d1add9832e5df295f04f3951166455b82b6b115a38:2235:2366` 2235:2366 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Messages/Content/Mermaid/Mermaid.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:a28d0c03450a8a128c8ab80abc202687a17b58c5b550396e6b6f45a1294ea692:2180:2444` 2180:2444 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:a28d0c03450a8a128c8ab80abc202687a17b58c5b550396e6b6f45a1294ea692:2764:2901` 2764:2901 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/Favorites/FavoriteItem.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:2076:2234` 2076:2234 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:2261:2394` 2261:2394 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:5363:5389` 5363:5389 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/Favorites/FavoritesList.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8a5dd402fcbf94410898bffd0c1ebe4d57673e1efbb606da70fa84f55cd95475:12815:13007` 12815:13007 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SearchBar.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:1941:2145` 1941:2145 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:2668:3063` 2668:3063 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:4399:4476` 4399:4476 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/Settings/Sidebar.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:7e6774488daa285c8b009f4e9e0ae5fa9cee14c107ed3180f6030ce06f0a42a8:1063:1099` 1063:1099 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:7e6774488daa285c8b009f4e9e0ae5fa9cee14c107ed3180f6030ce06f0a42a8:1122:1316` 1122:1316 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/ApiKeys/Create.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c017d10c094c96d1dd65aa537ac367527067431ce4e484f0728de30511e578c8:1044:1545` 1044:1545 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:c017d10c094c96d1dd65aa537ac367527067431ce4e484f0728de30511e578c8:1976:2111` 1976:2111 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/Chat/ChatDirection.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:493913766e56d0734523f1291a56cefbf56f279c542d15d58079ac7478c2a561:349:422` 349:422 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/Data/ImportConversations.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:f9097a46770876dbdb048c0f9fb1cb5102fb327e120a48650bfae4c9f3dd1325:2795:3013` 2795:3013 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:f9097a46770876dbdb048c0f9fb1cb5102fb327e120a48650bfae4c9f3dd1325:3180:3363` 3180:3363 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/Integrations/LangfuseConnection.tsx (5)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:12727:13875` 12727:13875 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:18350:18827` 18350:18827 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:20102:20317` 20102:20317 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:8602:9549` 8602:9549 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:9575:11088` 9575:11088 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Plugins/Store/PluginAuthForm.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:267e726c108bf75a014cf75937e00e0e3125e636a146ac36b999916e60eb9ab4:3403:3533` 3403:3533 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Plugins/Store/PluginPagination.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:bdd5f8c70167a52054cbe0af51dad6e14bfd6a691390067ec7656b5e064cd766:2508:2633` 2508:2633 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:bdd5f8c70167a52054cbe0af51dad6e14bfd6a691390067ec7656b5e064cd766:780:905` 780:905 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Projects/ProjectsView.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:4bcf6f448d90de90f942c36a8b20b8ef707fd443a325143901129cfac038ba0f:6770:6810` 6770:6810 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Prompts/fields/Command.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:ca5cca825c8c376313f9cbb6a3f748c95cb76b251a2f136186becd7366d45b6b:863:1125` 863:1125 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Prompts/fields/Description.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:0a1067aed04de7c54a7fd211df470518455c0ae818d724e8935a9d58af7d9841:852:994` 852:994 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Prompts/fields/PromptName.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:66d6caef31ca722e3a4f5731bd7c03a47e8231ba4b2d81451c9bae1e3c149356:1547:1999` 1547:1999 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:66d6caef31ca722e3a4f5731bd7c03a47e8231ba4b2d81451c9bae1e3c149356:974:1055` 974:1055 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Prompts/forms/PromptLabelsForm.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:0e46e06a569e0c56ba1886b3c552f393ec82d5e33deebcc66b5d477128a43973:602:686` 602:686 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:0e46e06a569e0c56ba1886b3c552f393ec82d5e33deebcc66b5d477128a43973:713:1215` 713:1215 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Prompts/forms/VariableForm.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:1870cb609ce1e2977308925c52cb776dae2b8d053edbcb16ebbb437c288d86b3:3835:4269` 3835:4269 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Prompts/sidebar/FilterPrompts.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:45095c6169e69b4d7f9d15f917dc23518cb8931904e150e14c250f6cfcc1e9b9:2684:2768` 2684:2768 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Sharing/PeoplePicker/PeoplePickerSearchItem.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:ba07e362b000fac2c4a0e32472bcec740732567a332faadeee0966ea7e668db8:1908:1958` 1908:1958 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/ActionsInput.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:194e7d9b485302c4084865e0baea276c8be5fd71bc7882522296bafd42b7769f:5809:6115` 5809:6115 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/Advanced/AdvancedPanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8c190a4842fef8aed34fcfb2254737db0feba11d0c059343012a174406593fe1:1157:1525` 1157:1525 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/Code/Files.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:70f3bf119eb143fb0565f14d2e004f4e44e2d4f0a810ce6837a8d5f9350895b0:1865:2043` 1865:2043 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:70f3bf119eb143fb0565f14d2e004f4e44e2d4f0a810ce6837a8d5f9350895b0:2122:2281` 2122:2281 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/DuplicateAgent.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:4699c1a67b067668b0b7ca39043fa389da6b19525aad89e31867d2e4dbe5e265:859:911` 859:911 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/FileSearch.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:6fe76399ecf32587c30a264889b0a43330d391da43f0d87777bb91b4e6cdb727:2995:3172` 2995:3172 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/Images.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:f58f7134821772a2cd06788f4a5cb224af3713a3c4aae46985401e899b0a8190:3292:3507` 3292:3507 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/ImageVision.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:bc1731a2cd78ab546afc49907e73e4e6a9667a87795b25a58b00e9a09561eeca:1119:1255` 1119:1255 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/SidePanel/Agents/MCPIcon.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:02e289adbd653e1c8f394d3148ee2a6d9f0d3b1e80648a1040c285bd1719c1f9:767:899` 767:899 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/ModelPanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:91de705a9d09aa413eb1e56614762f75457313382f64c8b189e698e83c063e35:3745:3912` 3745:3912 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/Tools/ToolCard.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:0a328660c71874b1ddcab7094fa80257aea588bdb955981de2ecc05ee5c9cef2:7499:7597` 7499:7597 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:0a328660c71874b1ddcab7094fa80257aea588bdb955981de2ecc05ee5c9cef2:8382:8485` 8382:8485 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Bookmarks/BookmarkTable.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:5f44a8add82e5a561d6190d4ade936f81581c344d161a4a3f9e2dfb587ba86ba:2450:2487` 2450:2487 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/Action.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:87fc59f13e88ab2ea9cfb4519aeecac4e34e1a9b7eea8a4f3bcc49bd51742782:417:514` 417:514 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/ActionCallback.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:1ce445aa7350ef70097d0f66283559370c0419914540542d94f5a8dd3dd15894:1243:1282` 1243:1282 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/ActionsInput.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8f844a16b12bdee5ba69b5e8bfe9c9a034b1cb81722251ddbf5ec9edd36be5a1:5522:5771` 5522:5771 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/AssistantConversationStarters.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:3a6bbea98b146d9943380fa42fa1d3d4ad275516641374b1f563faca56e0ba58:2611:2647` 2611:2647 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:3a6bbea98b146d9943380fa42fa1d3d4ad275516641374b1f563faca56e0ba58:2672:2952` 2672:2952 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/CodeFiles.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:959b9f2a3757570abea2a9493d77a443de77a399b2ba7d2e8e12b2e822c4a77f:1613:1772` 1613:1772 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/Knowledge.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c3df6f50ce309c4f04ed9e37fe932b05432ea888f5aa6fd3201bb61463e42a87:1911:2070` 1911:2070 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Files/PanelTable.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:741e29f66911249f519aa213222051aa44da31a8e2099d5a97a5e238ad7158a7:6307:6381` 6307:6381 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/MCPBuilder/MCPBuilderPanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:3925a452e0f677c8cd65827655ff460f4a8056e4e2e95db496a139398d5f1ddc:1984:2021` 1984:2021 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/MCPBuilder/MCPServerDialog/sections/BasicInfoSection.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:ba75c638c7e66ce4a02def01df7ddd2c949be7e1577c39f17c53fc35a8bd284c:571:889` 571:889 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Memories/MemoryPanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:5d9ecbdfd094da400d7d322df144bb223a582e1b4d03baf299fd11f6b1895fa0:5798:5835` 5798:5835 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Skills/buttons/SkillToggle.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:61e49a4d16b49b7c12c41e8e04a9bb5cd5b0bee3f0530b71ae7a7249226cd39b:369:434` 369:434 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Skills/lists/SkillListItem.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:4286:4528` 4286:4528 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:8461:8553` 8461:8553 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:8956:9102` 8956:9102 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Skills/sidebar/SkillsSidePanel.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:386529887fa39d8a9facde68342434eded01cfca2546e2cca039fe54819c17e2:1339:1399` 1339:1399 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:386529887fa39d8a9facde68342434eded01cfca2546e2cca039fe54819c17e2:1987:2023` 1987:2023 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Skills/tree/SkillFileEditor.tsx (3)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1193:1365` 1193:1365 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1427:1670` 1427:1670 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1772:1920` 1772:1920 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/UnifiedSidebar/Sidebar.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:57305242ea18ed000a9de65dafbcfc1a91aafd91cb195177edf87776db62329c:1672:1866` 1672:1866 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/routes/RouteErrorBoundary.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:2351:3240` 2351:3240 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:3269:3422` 3269:3422 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/utils/index.ts (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:4258261b7fb1cfdb83c27dc4d4d03a62f8810d89cac3865b11e3fd0ad1538369:3981:4224` 3981:4224 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### packages/client/src/components/Badge.tsx (3)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:d0ac022ffaeeb57e7f82d56ed1f8e36a4d51d62cbc3bb31279bd955930380b64:1069:1288` 1069:1288 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:d0ac022ffaeeb57e7f82d56ed1f8e36a4d51d62cbc3bb31279bd955930380b64:3140:3166` 3140:3166 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:d0ac022ffaeeb57e7f82d56ed1f8e36a4d51d62cbc3bb31279bd955930380b64:3187:3271` 3187:3271 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/DataTable.tsx (3)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:3fff0cce4fdac42df2ac2564fa1ef0cd23b3d7d180002260a99a38b34f07e14a:12847:12883` 12847:12883 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:3fff0cce4fdac42df2ac2564fa1ef0cd23b3d7d180002260a99a38b34f07e14a:1290:1316` 1290:1316 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:3fff0cce4fdac42df2ac2564fa1ef0cd23b3d7d180002260a99a38b34f07e14a:1400:1426` 1400:1426 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/DataTable/DataTableComponents.tsx (2)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:04c3b7a8cdbc5230f68ebb77843afeb5944a229c0302c982e5f6aa250fa56183:1120:1193` 1120:1193 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:04c3b7a8cdbc5230f68ebb77843afeb5944a229c0302c982e5f6aa250fa56183:876:1041` 876:1041 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/DataTable/DataTableSearch.tsx (1)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:cc5bd4cc764e05f6e3767a28769ef5a56276dc4e975b5dbe6238f76424bd9a42:882:963` 882:963 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/FormInput.tsx (1)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:936ae20d7e67f80adc98f3aca56e2f88509d3009cc63a4d81e85dd5fd3dce8e9:805:1104` 805:1104 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/InputWithDropDown.tsx (3)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:59255ac636f4a2b0817ace265e7376ea015aabe39f47d2937cfb743942d99494:1198:1349` 1198:1349 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:59255ac636f4a2b0817ace265e7376ea015aabe39f47d2937cfb743942d99494:1378:2226` 1378:2226 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:59255ac636f4a2b0817ace265e7376ea015aabe39f47d2937cfb743942d99494:3354:3378` 3354:3378 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/MultiSearch.tsx (2)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:cf59288b5ae3a75b1389f5bb2f86137a646a07aaf4e511e0d78b54719950db0b:620:651` 620:651 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:cf59288b5ae3a75b1389f5bb2f86137a646a07aaf4e511e0d78b54719950db0b:697:793` 697:793 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/SecretInput.tsx (2)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:d8c88d65fb122c49ea8441ebc230719fc94b8d574579243b1c293638f8f0766f:1444:1494` 1444:1494 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:d8c88d65fb122c49ea8441ebc230719fc94b8d574579243b1c293638f8f0766f:1537:2015` 1537:2015 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/Tag.tsx (1)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:d19866ec29f6681eb79ac190f0f7d6b8bd7e1ab8c12e0f0ff7bc1fe443c748ba:1031:1121` 1031:1121 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/ThemeSelector.tsx (2)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:f607e3900a9d4f60b7811dba6cd08cc15e1c9973b71c9541599db447d14af3c3:1485:1558` 1485:1558 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:f607e3900a9d4f60b7811dba6cd08cc15e1c9973b71c9541599db447d14af3c3:1577:1714` 1577:1714 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

## Remaining after registration fixes (61)

### client/src/components/Agents/AgentDetailContent.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:1270:1341` 1270:1341 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:1428:2674` 1428:2674 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:2764:3185` 2764:3185 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Agents/VirtualizedAgentGrid.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:d622f227b9eef88918b0d0a62420924e4bad180be878bfd2e36495f690e30c79:6684:6699` 6684:6699 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Artifacts/DownloadArtifact.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:ffc59f8eebf951ab5b669798c20b9f962c42efa526acab9e74f9085048d274d1:2946:3512` 2946:3512 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Auth/LoginForm.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3043:3197` 3043:3197 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Banners/Banner.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:b6203e7c6f63c62a1b89738edb0ee3d46da7a537b3572805f67d5b41ce801ed5:1352:1533` 1352:1533 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Input/Files/FileUpload.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:6b26e620c0d92d1630684e9fd7d45ba2a037600280430b72cbc88d215675ddd2:1761:1912` 1761:1912 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/Content/AskUserQuestion.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:bfc4c9499f98a4aab7d563d89d39dc13dfd1dafb5eafe80e43abf817ad5d8af2:3494:3940` 3494:3940 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Chat/Messages/SearchButtons.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:266ed5994412e263969373eccdb859fe7b2d7aea6404ed2fc2f31615cc32bce2:844:1644` 844:1644 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Conversations/ConvoOptions/ProjectButton.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:6ad4d60b462e8d5ab6368aca90724f6d80d601743f7ce2da87de4aa8c4a9c2f6:1697:2344` 1697:2344 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Files/FileDashboardView.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:0475bb72f9319e08d00ae3af4c702d3b512b61f78f37a0bb4e7fb28b8fd90055:587:638` 587:638 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/DataTableFile.tsx (6)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:10285:10307` 10285:10307 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:3051:3112` 3051:3112 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:3202:3520` 3202:3520 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:5422:5496` 5422:5496 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:5640:5666` 5640:5666 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:9995:10021` 9995:10021 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FileListItem.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:8e925481b2035a3cc0de6c4fb5e41440d25d6d0adb47c15754600b963fe8f92e:1038:1064` 1038:1064 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FileListItem2.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:56dc297e78b3a4fb1a73954ad68a143f1196dccb7dcf48736ae456d4c9b7c25d:2418:2444` 2418:2444 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:56dc297e78b3a4fb1a73954ad68a143f1196dccb7dcf48736ae456d4c9b7c25d:564:615` 564:615 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FilePreview.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:c32a085d693ec0b4b1e2903b72e473277ddb63c6ac4872af4b1f544d2a0c5634:2256:2317` 2256:2317 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:c32a085d693ec0b4b1e2903b72e473277ddb63c6ac4872af4b1f544d2a0c5634:2438:2499` 2438:2499 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FileList/FileSidePanel.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:0c255a81fd40d0536a91a5cb819a482b5157383bdf1fd8aab23e866f1260a933:3666:3725` 3666:3725 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:0c255a81fd40d0536a91a5cb819a482b5157383bdf1fd8aab23e866f1260a933:3921:3979` 3921:3979 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FilesListView.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:e1ad42af472e990080e15f6da3d2bd1246d046837fad6a6764e288e4bd545b64:769:826` 769:826 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/FilesSectionSelector.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:00a5704415faedb561f3dd76ae63d1d714935005b7e7bd2a5dab52fac5025879:1307:1397` 1307:1397 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:00a5704415faedb561f3dd76ae63d1d714935005b7e7bd2a5dab52fac5025879:925:1031` 925:1031 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStore/VectorStoreListItem.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:5c4e2864dd5d55fa6b501df1b4379fc6527ce6617a01d95716825341dc0845d1:1679:1719` 1679:1719 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:5c4e2864dd5d55fa6b501df1b4379fc6527ce6617a01d95716825341dc0845d1:547:596` 547:596 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStore/VectorStorePreview.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:945f9a87afab4bd2681e9d7d88a89e6832ec51471a72618225da7e298013c0d2:2909:2970` 2909:2970 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:945f9a87afab4bd2681e9d7d88a89e6832ec51471a72618225da7e298013c0d2:3073:3127` 3073:3127 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStore/VectorStoreSidePanel.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:900d70774a3b22f4536464db0fc09395340e359e12b9c4a1f45120a9727cd12d:4766:4829` 4766:4829 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:900d70774a3b22f4536464db0fc09395340e359e12b9c4a1f45120a9727cd12d:5038:5110` 5038:5110 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/Files/VectorStoreView.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:4d4db847787857822a18476b1eea9415d9bd918a895b659e683f67a7b76410e3:679:740` 679:740 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/MCP/CustomUserVarsSection.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:0efbfb1c1bd3cdf2db8b18846e78e6f2fa2c669f9d6b0c921758c7a9b331e794:5021:5061` 5021:5061 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/ApiKeys/Create.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c017d10c094c96d1dd65aa537ac367527067431ce4e484f0728de30511e578c8:1044:1545` 1044:1545 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/Chat/ChatDirection.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:493913766e56d0734523f1291a56cefbf56f279c542d15d58079ac7478c2a561:349:422` 349:422 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Nav/SettingsTabs/Integrations/LangfuseConnection.tsx (3)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:12727:13875` 12727:13875 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:8602:9549` 8602:9549 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:9575:11088` 9575:11088 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Prompts/forms/PromptLabelsForm.tsx (2)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:0e46e06a569e0c56ba1886b3c552f393ec82d5e33deebcc66b5d477128a43973:602:686` 602:686 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:0e46e06a569e0c56ba1886b3c552f393ec82d5e33deebcc66b5d477128a43973:713:1215` 713:1215 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/SidePanel/Agents/Advanced/AdvancedPanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:8c190a4842fef8aed34fcfb2254737db0feba11d0c059343012a174406593fe1:1157:1525` 1157:1525 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/Code/Files.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:70f3bf119eb143fb0565f14d2e004f4e44e2d4f0a810ce6837a8d5f9350895b0:2122:2281` 2122:2281 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/DuplicateAgent.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:4699c1a67b067668b0b7ca39043fa389da6b19525aad89e31867d2e4dbe5e265:859:911` 859:911 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Agents/ImageVision.tsx (1)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:bc1731a2cd78ab546afc49907e73e4e6a9667a87795b25a58b00e9a09561eeca:1119:1255` 1119:1255 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/components/SidePanel/Agents/ModelPanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:91de705a9d09aa413eb1e56614762f75457313382f64c8b189e698e83c063e35:3745:3912` 3745:3912 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/CodeFiles.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:959b9f2a3757570abea2a9493d77a443de77a399b2ba7d2e8e12b2e822c4a77f:1613:1772` 1613:1772 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/SidePanel/Builder/Knowledge.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:c3df6f50ce309c4f04ed9e37fe932b05432ea888f5aa6fd3201bb61463e42a87:1911:2070` 1911:2070 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Skills/sidebar/SkillsSidePanel.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:386529887fa39d8a9facde68342434eded01cfca2546e2cca039fe54819c17e2:1339:1399` 1339:1399 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### client/src/components/Skills/tree/SkillFileEditor.tsx (3)

- reason: skipped_file_not_emitted_to_served_chunks
- registration fix applied: none_not_present_in_served_chunks

- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1193:1365` 1193:1365 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1427:1670` 1427:1670 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1772:1920` 1772:1920 — reason=skipped_file_not_emitted_to_served_chunks; fix_applied=none_not_present_in_served_chunks

### client/src/routes/RouteErrorBoundary.tsx (2)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:2351:3240` 2351:3240 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary
- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:3269:3422` 3269:3422 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

### packages/client/src/components/DataTable/DataTableComponents.tsx (2)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:04c3b7a8cdbc5230f68ebb77843afeb5944a229c0302c982e5f6aa250fa56183:1120:1193` 1120:1193 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map
- `function:04c3b7a8cdbc5230f68ebb77843afeb5944a229c0302c982e5f6aa250fa56183:876:1041` 876:1041 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/DataTable/DataTableSearch.tsx (1)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:cc5bd4cc764e05f6e3767a28769ef5a56276dc4e975b5dbe6238f76424bd9a42:882:963` 882:963 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/FormInput.tsx (1)

- reason: compiled_package_path
- registration fix applied: recursive_compiled_package_source_map

- `function:936ae20d7e67f80adc98f3aca56e2f88509d3009cc63a4d81e85dd5fd3dce8e9:805:1104` 805:1104 — reason=compiled_package_path; fix_applied=recursive_compiled_package_source_map

### packages/client/src/components/MultiSearch.tsx (1)

- reason: syntactic_form_or_source_map_span
- registration fix applied: post_bundle_entry_probe_plus_exact_original_boundary

- `function:cf59288b5ae3a75b1389f5bb2f86137a646a07aaf4e511e0d78b54719950db0b:697:793` 697:793 — reason=syntactic_form_or_source_map_span; fix_applied=post_bundle_entry_probe_plus_exact_original_boundary

