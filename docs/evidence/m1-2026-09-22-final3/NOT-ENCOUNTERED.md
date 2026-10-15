# Static units not encountered

Total: 318

These units were never rendered in a visited authenticated state. Each group retains the analyzer placement surface and conditions; `route: unavailable` means the static placement did not contain a literal route.

## client/src/components/Agents/AgentDetailContent.tsx (3)

### Button — agent builder (3)

- route: unavailable
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:1270:1341|click`; placement=placement:3c8fefa66d9cb44a8185ad8a; conditions=none
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:1428:2674|click`; placement=placement:b39e16d2a53c27e322702b44; conditions=none
- `function:69c0124e0c5a67f1cb793185b6986aa7c6416a3410b909438b216aed4e3518ce:2764:3185|click`; placement=placement:0560afcc7140c92e8361329d; conditions=none

## client/src/components/Agents/AgentGrid.tsx (1)

### Button — agent builder (1)

- route: unavailable
- `function:f0c7edf3788823d1b55a3240ad3c20f80859af76af5ba37b0bf31b4debbc7e1a:4019:4034|click`; placement=placement:01bb899bf04dade77c866687; conditions=error:truthy; onRetry:truthy

## client/src/components/Agents/SearchBar.tsx (2)

### Input — agent builder (1)

- route: unavailable
- `function:af7a114f45953b092b7cbedc7633c433667bf18eabd982d79041ea3373ed401a:1680:1764|change`; placement=placement:c4626d8c4ab00ce5dea6bb61; conditions=none

### SearchBar — agent builder (1)

- route: unavailable
- `function:af7a114f45953b092b7cbedc7633c433667bf18eabd982d79041ea3373ed401a:1859:2008|click`; placement=placement:d24a877dacb481d3be83ae21; conditions=searchTerm:truthy

## client/src/components/Agents/VirtualizedAgentGrid.tsx (1)

### Button — agent builder (1)

- route: unavailable
- `function:d622f227b9eef88918b0d0a62420924e4bad180be878bfd2e36495f690e30c79:6684:6699|click`; placement=placement:fe53d8626cb0e55c3c430a67; conditions=error:truthy; onRetry:truthy

## client/src/components/Artifacts/DownloadArtifact.tsx (1)

### Button — export or download dialog (1)

- route: unavailable
- `function:ffc59f8eebf951ab5b669798c20b9f962c42efa526acab9e74f9085048d274d1:2946:3512|click`; placement=placement:49e2557b92c3798dd8271f86; conditions=none

## client/src/components/Auth/LoginForm.tsx (2)

### LoginForm — authentication route (2)

- route: unavailable
- `function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3043:3197|click`; placement=placement:de73a6d00813f0d7b43403b6; conditions=shouldAutoRedirect:falsy; startupConfig?.emailLoginEnabled === true:truthy; !startupConfig:falsy; showResendLink:truthy
- `function:c15c44aa0e87167c0174eb68367210b93204299c880fce28068d3117f8c0bf0e:3870:3894|submit`; placement=placement:de73a6d00813f0d7b43403b6; conditions=shouldAutoRedirect:falsy; startupConfig?.emailLoginEnabled === true:truthy; !startupConfig:falsy

## client/src/components/Auth/Registration.tsx (1)

### Registration — authentication route (1)

- route: unavailable
- `function:5f6c35ceae5defb4d92a988b52eef18913e34d37a17b0864a9a56520bad36700:5864:5962|submit`; placement=placement:045b7d77e4422049b5393520; conditions=!startupConfigError && !isFetching:truthy

## client/src/components/Auth/RequestPasswordReset.tsx (1)

### RequestPasswordReset — authentication route (1)

- route: unavailable
- `function:b061f811a3e788bf9d7d8f70a25603c5b25fc8e18f42cfb3d49c480ad20d16e3:1832:2705|submit`; placement=placement:4ac69142342e9a5565cfdc2b; conditions=bodyText:falsy

## client/src/components/Auth/ResetPassword.tsx (2)

### ResetPassword — authentication route (1)

- route: unavailable
- `function:59f5b8ad054afc4866962d49bff8b17e072f6a57f04eec6f8b5fcad75b1428e9:1808:2060|submit`; placement=placement:496058e126bbf2b53a6de7c1; conditions=resetPassword.isSuccess:falsy

### Button — authentication route (1)

- route: unavailable
- `function:59f5b8ad054afc4866962d49bff8b17e072f6a57f04eec6f8b5fcad75b1428e9:2505:2529|click`; placement=placement:7d3db7146360192329aa45bb; conditions=resetPassword.isSuccess:truthy

## client/src/components/Auth/TwoFactorScreen.tsx (3)

### TwoFactorScreen — authentication route (3)

- route: unavailable
- `function:e3df304f749403c6918bdc7a03561d820f898c65ceef1398c840d8bdd8da99ff:1870:2219|submit`; placement=placement:245e9ba01d112bbdddd0f5f1; conditions=none
- `function:e3df304f749403c6918bdc7a03561d820f898c65ceef1398c840d8bdd8da99ff:2310:2345|click`; placement=placement:245e9ba01d112bbdddd0f5f1; conditions=!useBackup:truthy
- `function:e3df304f749403c6918bdc7a03561d820f898c65ceef1398c840d8bdd8da99ff:2391:2427|click`; placement=placement:245e9ba01d112bbdddd0f5f1; conditions=!useBackup:falsy

## client/src/components/Auth/VerifyEmail.tsx (1)

### VerificationSuccess — authentication route (1)

- route: unavailable
- `function:d04e1b8fa5d8601f9b0d9ca112f61259c9e65b1392877c661c48498fbe890c67:2019:2073|click`; placement=placement:815b836e9988d6f1e8a14792; conditions=verificationStatus:truthy; showResendLink && countdown === 0:truthy

## client/src/components/Banners/Banner.tsx (1)

### Button — authentication route (1)

- route: unavailable
- `function:b6203e7c6f63c62a1b89738edb0ee3d46da7a537b3572805f67d5b41ce801ed5:1352:1533|click`; placement=placement:a3a7a27dc9726cba68013f60; conditions=!banner ||
    (banner.bannerId && !banner.persistable && hideBannerHint.includes(banner.bannerId)):falsy; !banner.persistable:truthy; !banner ||
    (banner.bannerId && !banner.persistable && hideBannerHint.includes(banner.bannerId)):falsy; !banner.persistable:truthy

## client/src/components/Bookmarks/BookmarkForm.tsx (2)

### BookmarkForm — bookmarks panel (2)

- route: unavailable
- `function:b83cb0b266b107d513faa1f082c075403054dda09effd18c98fb34989ea4de14:1806:2646|submit`; placement=placement:55b1ab25c470abaee5e626dd; conditions=none
- `function:b83cb0b266b107d513faa1f082c075403054dda09effd18c98fb34989ea4de14:6304:6457|click`; placement=placement:55b1ab25c470abaee5e626dd; conditions=conversationId != null && conversationId:truthy

## client/src/components/Chat/Input/AskUserQuestionPopover.tsx (3)

### AskUserQuestionPopoverPanel — conversation list or menu (1)

- route: unavailable
- `function:55c6aed1df5f0b28c7e8708dbaa363983cc53ce145f613667a08e49cb49ab215:7743:7778|click`; placement=placement:478d5173be819d2d8a165276; conditions=conversationId == null || conversationId === 'new':falsy; !ask.popoverVisible || !ask.liveAsk:falsy; !liveAsk:falsy

### Button — conversation list or menu (2)

- route: unavailable
- `function:55c6aed1df5f0b28c7e8708dbaa363983cc53ce145f613667a08e49cb49ab215:8079:8091|click`; placement=placement:5ff605f776a84209f6e79550; conditions=conversationId == null || conversationId === 'new':falsy; !ask.popoverVisible || !ask.liveAsk:falsy; !liveAsk:falsy
- `function:55c6aed1df5f0b28c7e8708dbaa363983cc53ce145f613667a08e49cb49ab215:8384:8410|click`; placement=placement:c3397aceb3280d935b2719a6; conditions=conversationId == null || conversationId === 'new':falsy; !ask.popoverVisible || !ask.liveAsk:falsy; !liveAsk:falsy; multiSelect && options.length > 0:truthy

## client/src/components/Chat/Input/BadgeRow.tsx (1)

### BadgeWrapper — chat message surface (1)

- route: unavailable
- `function:0fc897faba6aa1c96b626d96d2d1505ea324da5bc198d355ba7316277246279b:1999:2037|mousedown`; placement=placement:3dc8909d932333826a188442; conditions=none

## client/src/components/Chat/Input/Files/FileUpload.tsx (2)

### FileUpload — files and previews (2)

- route: unavailable
- `function:6b26e620c0d92d1630684e9fd7d45ba2a037600280430b72cbc88d215675ddd2:1761:1912|click`; placement=placement:6a72eed2794968ba542fcd0d; conditions=none
- `function:6b26e620c0d92d1630684e9fd7d45ba2a037600280430b72cbc88d215675ddd2:852:1454|change`; placement=placement:6a72eed2794968ba542fcd0d; conditions=none

## client/src/components/Chat/Input/Files/ImagePreview.tsx (5)

### ImagePreview — files and previews (4)

- route: unavailable
- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:3593:3695|click`; placement=placement:1ec77f126b74ef4039f233d4; conditions=typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy; file?.type?.startsWith('image') === true:truthy; typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy
- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:3811:3835|focus`; placement=placement:1ec77f126b74ef4039f233d4; conditions=typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy; file?.type?.startsWith('image') === true:truthy; typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy
- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:3853:3878|blur`; placement=placement:1ec77f126b74ef4039f233d4; conditions=typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy; file?.type?.startsWith('image') === true:truthy; typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy
- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:6100:6126|click`; placement=placement:1ec77f126b74ef4039f233d4; conditions=typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy; file?.type?.startsWith('image') === true:truthy; typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy

### Button — files and previews (1)

- route: unavailable
- `function:decb7bfd9343c8e68617f1c73720565aac74a11717ae6e7f45f48695e320f288:5752:5781|click`; placement=placement:63e3648abf9f6c19da0f7567; conditions=typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy; file?.type?.startsWith('image') === true:truthy; typeof style.backgroundImage !== 'string' || style.backgroundImage.length === 0:falsy

## client/src/components/Chat/Input/InFlightSteers.tsx (1)

### InFlightSteer — chat message surface (1)

- route: unavailable
- `function:dd51df60731b7b2179d0dff050f6b918c741b541253bbf28d7e0a06f776ffa3f:19883:19917|click`; placement=placement:01b79282c883a40b4c9adeca; conditions=overflowing:truthy

## client/src/components/Chat/Input/Mention.tsx (4)

### MentionContent — chat message surface (4)

- route: unavailable
- `function:c6d4b08f53d65c3368352a0618b16f23cccee2b6fb13d77930225059e4c5225d:5702:7148|keydown`; placement=placement:9dcb143a6541552f9a67b20a; conditions=!show:falsy
- `function:c6d4b08f53d65c3368352a0618b16f23cccee2b6fb13d77930225059e4c5225d:7170:7207|change`; placement=placement:9dcb143a6541552f9a67b20a; conditions=!show:falsy
- `function:c6d4b08f53d65c3368352a0618b16f23cccee2b6fb13d77930225059e4c5225d:7228:7247|focus`; placement=placement:9dcb143a6541552f9a67b20a; conditions=!show:falsy
- `function:c6d4b08f53d65c3368352a0618b16f23cccee2b6fb13d77930225059e4c5225d:7267:7426|blur`; placement=placement:9dcb143a6541552f9a67b20a; conditions=!show:falsy

## client/src/components/Chat/Input/PendingQuoteChips.tsx (1)

### PendingQuoteChips — chat message surface (1)

- route: unavailable
- `function:9fe6e010d0529e7d5a9f51b65c094deba9d3210328cfd74624cc3db918cbb40e:3183:3202|click`; placement=placement:c9b3b864196c335c1bb0d94e; conditions=quotes.length === 0:falsy; !isMulti:falsy

## client/src/components/Chat/Input/PendingSteerChips.tsx (4)

### FailedSteerRow — chat message surface (2)

- route: unavailable
- `function:1fc486cdf7ffd70df40562bfc52b8a649f137e0e3246df27f711063e0c99cf14:10572:10613|click`; placement=placement:4b9abc05875813ec603f88af; conditions=!steer.deliveryUncertain:truthy
- `function:1fc486cdf7ffd70df40562bfc52b8a649f137e0e3246df27f711063e0c99cf14:9628:10264|click`; placement=placement:4b9abc05875813ec603f88af; conditions=canRetry:truthy

### QueuedRow — chat message surface (2)

- route: unavailable
- `function:1fc486cdf7ffd70df40562bfc52b8a649f137e0e3246df27f711063e0c99cf14:5695:5732|click`; placement=placement:c5996e31dac040ee6fac48d3; conditions=showPrimary:truthy
- `function:1fc486cdf7ffd70df40562bfc52b8a649f137e0e3246df27f711063e0c99cf14:6549:7240|click`; placement=placement:c5996e31dac040ee6fac48d3; conditions=none

## client/src/components/Chat/Input/QuoteButton.tsx (2)

### QuoteButton — chat message surface (2)

- route: unavailable
- `function:75f32896411a3ab25642d745d3682ef5fd9a661d711ad25ea95b65f896af07f3:5917:6265|click`; placement=placement:6fed62080fb38d62a61917dc; conditions=!selection:falsy; React renderer consumed portal children:truthy
- `function:75f32896411a3ab25642d745d3682ef5fd9a661d711ad25ea95b65f896af07f3:6492:6517|mousedown`; placement=placement:6fed62080fb38d62a61917dc; conditions=!selection:falsy; React renderer consumed portal children:truthy

## client/src/components/Chat/Input/SkillsCommand.tsx (4)

### SkillsCommandContent — chat message surface (4)

- route: unavailable
- `function:dbfb380b58a6fada0f65c796d99249511ad79f02c8f7ad71c8681dcba2083054:10605:10642|change`; placement=placement:e575a99ea4745d9447059617; conditions=!show:falsy
- `function:dbfb380b58a6fada0f65c796d99249511ad79f02c8f7ad71c8681dcba2083054:10663:10682|focus`; placement=placement:e575a99ea4745d9447059617; conditions=!show:falsy
- `function:dbfb380b58a6fada0f65c796d99249511ad79f02c8f7ad71c8681dcba2083054:10702:10867|blur`; placement=placement:e575a99ea4745d9447059617; conditions=!show:falsy
- `function:dbfb380b58a6fada0f65c796d99249511ad79f02c8f7ad71c8681dcba2083054:9267:10583|keydown`; placement=placement:e575a99ea4745d9447059617; conditions=!show:falsy

## client/src/components/Chat/Menus/Endpoints/components/EndpointItem.tsx (2)

### SettingsButton — chat message surface (2)

- route: unavailable
- `function:be196c2c5396dd96f98d4106df67757ce972ca9651141e1da49b362a340a89fe:1310:1493|click`; placement=placement:4826446b1266d29749df72d4; conditions=none
- `function:be196c2c5396dd96f98d4106df67757ce972ca9651141e1da49b362a340a89fe:1520:1810|keydown`; placement=placement:4826446b1266d29749df72d4; conditions=none

## client/src/components/Chat/Menus/UI/MenuItem.tsx (1)

### MenuItem — chat message surface (1)

- route: unavailable
- `function:c621eefc22dd89f7de03f4213c12c8d9a6b1ba95a8ac58dc148d9a60860a667c:1201:1367|keydown`; placement=placement:ba60ddb4e7b4fe1db6e87f56; conditions=none

## client/src/components/Chat/Messages/Content/AgentHandoff.tsx (1)

### AgentHandoff — agent builder (1)

- route: unavailable
- `function:99fdfdf53c973905539a7498905632f27f297a92d8ed228b9b222306dee2bed1:1944:1972|click`; placement=placement:6c4eac756b04329a1235bb94; conditions=none

## client/src/components/Chat/Messages/Content/AskUserQuestion.tsx (1)

### Button — chat message surface (1)

- route: unavailable
- `function:bfc4c9499f98a4aab7d563d89d39dc13dfd1dafb5eafe80e43abf817ad5d8af2:3494:3940|click`; placement=placement:c41d8dc54f523ce1b90ece24; conditions=!part:falsy; askUserQuestion:truthy; popoverVisible && isLivePause:falsy; status === 'submitted':falsy

## client/src/components/Chat/Messages/Content/DialogImage.tsx (6)

### DialogImage — chat message surface (3)

- route: unavailable
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:10284:10310|click`; placement=placement:8443b6f77a2054d1856369af; conditions=isAgentStyle && !hideAttachments:truthy; filepath:truthy; !part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:4074:4293|mousedown`; placement=placement:8443b6f77a2054d1856369af; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy; isAgentStyle && !hideAttachments:truthy; filepath:truthy
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:4681:4718|mouseup`; placement=placement:8443b6f77a2054d1856369af; conditions=isAgentStyle && !hideAttachments:truthy; filepath:truthy; !part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy

### DialogImage — files and previews (2)

- route: unavailable
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:11765:11791|click`; placement=placement:200a0c72adc5752115caaeae; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy; isAgentStyle && !hideAttachments:truthy; filepath:truthy
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:2942:3029|doubleclick`; placement=placement:200a0c72adc5752115caaeae; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy; isAgentStyle && !hideAttachments:truthy; filepath:truthy

### Button — files and previews (1)

- route: unavailable
- `function:150705a430980ef50f4e80eefb13cb5cbf124ce51842a0bbab8c7c4803fecf9a:12132:12160|click`; placement=placement:b720fa80790df7fb312869c3; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy; isAgentStyle && !hideAttachments:truthy; filepath:truthy

## client/src/components/Chat/Messages/Content/Image.tsx (1)

### Image — files and previews (1)

- route: unavailable
- `function:c2032d363f149f2ed411eb46604f30a75476c18a4ffe3b21654cf2852aee7dbb:3542:3563|click`; placement=placement:9222a926c04bf17f5ab92d1f; conditions=isAgentStyle && !hideAttachments:truthy; filepath:truthy; !part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:falsy; part.type === ContentTypes.IMAGE_FILE:truthy

## client/src/components/Chat/Messages/Content/MemoryArtifacts.tsx (1)

### MemoryArtifacts — chat message surface (1)

- route: unavailable
- `function:db6408fd06ab6ed119232f1c1860718bdc637294cbeba5f7cdf6454f9da1dfbb:2972:3006|click`; placement=placement:23a4c8e3ec59810f9f7f6af9; conditions=!memoryArtifacts || memoryArtifacts.length === 0:falsy; !memoryArtifacts || memoryArtifacts.length === 0:falsy

## client/src/components/Chat/Messages/Content/Parts/Attachment.tsx (2)

### FileAttachmentGroup — files and previews (1)

- route: unavailable
- `function:33cce1d24814f16f334b5dcb5277171cfab0d4710406fc1d5ccd6115da4420be:10104:10140|click`; placement=placement:6c322bf369936753038e97cf; conditions=count === 0:falsy; count === 1:falsy

### TextAttachment — chat message surface (1)

- route: unavailable
- `function:33cce1d24814f16f334b5dcb5277171cfab0d4710406fc1d5ccd6115da4420be:16053:16087|click`; placement=placement:33463d2eb6423d9ddfd2e907; conditions=overflowed:truthy

## client/src/components/Chat/Messages/Content/Parts/EditTextPart.tsx (3)

### EditTextPart — chat message surface (3)

- route: unavailable
- `function:bba5136fd85b15d10aedc0ed1461750b045200aea515cb8f244f1096faacdeee:2137:2927|click`; placement=placement:578cea77e89316b440dbda22; conditions=none
- `function:bba5136fd85b15d10aedc0ed1461750b045200aea515cb8f244f1096faacdeee:2954:3786|click`; placement=placement:578cea77e89316b440dbda22; conditions=none
- `function:bba5136fd85b15d10aedc0ed1461750b045200aea515cb8f244f1096faacdeee:6601:6622|click`; placement=placement:578cea77e89316b440dbda22; conditions=none

## client/src/components/Chat/Messages/Content/Parts/Reasoning.tsx (3)

### ThinkingButton — chat message surface (1)

- route: unavailable
- `function:8c03949d40e9fd06eba1a1a27e2aba7608959fe59c89c84401021602c7d6ed99:2227:2330|click`; placement=placement:ed07220a68d64d2767ad089e; conditions=!reasoningText:falsy

### Reasoning — chat message surface (2)

- route: unavailable
- `function:8c03949d40e9fd06eba1a1a27e2aba7608959fe59c89c84401021602c7d6ed99:2372:2410|focus`; placement=placement:823baa64b0659164f9ac9041; conditions=!reasoningText:falsy
- `function:8c03949d40e9fd06eba1a1a27e2aba7608959fe59c89c84401021602c7d6ed99:2451:2579|blur`; placement=placement:823baa64b0659164f9ac9041; conditions=!reasoningText:falsy

## client/src/components/Chat/Messages/Content/Parts/SubagentCall.tsx (1)

### SubagentCall — agent builder (1)

- route: unavailable
- `function:0b2efbbff4a39340fe6f17c84d11e1dfeb8616c9d35e9c695c91ca477e0b7d7b:19611:19630|click`; placement=placement:aeeb5449e5c73fc90821798a; conditions=none

## client/src/components/Chat/Messages/Content/Parts/Summary.tsx (2)

### Summary — chat message surface (2)

- route: unavailable
- `function:1b3b6981d2bdc48e22d885cec52744240382dca70e094a51b339fbf08bfb5318:7975:8002|focus`; placement=placement:a36754d3798ba080c900f6ea; conditions=!summarizing && !text:falsy
- `function:1b3b6981d2bdc48e22d885cec52744240382dca70e094a51b339fbf08bfb5318:8042:8170|blur`; placement=placement:a36754d3798ba080c900f6ea; conditions=!summarizing && !text:falsy

## client/src/components/Chat/Messages/Content/Parts/Thinking.tsx (3)

### ThinkingButton — chat message surface (1)

- route: unavailable
- `function:0f137964e79d4fce63a5490e15f25ebab7bb2a200a8417a950818069eb8248b6:1751:1993|click`; placement=placement:ed07220a68d64d2767ad089e; conditions=!reasoningText:falsy; content && showCopyButton:truthy

### Thinking — chat message surface (2)

- route: unavailable
- `function:0f137964e79d4fce63a5490e15f25ebab7bb2a200a8417a950818069eb8248b6:8696:8734|focus`; placement=placement:e2e4cd91bbc40955b89fb10f; conditions=children == null:falsy
- `function:0f137964e79d4fce63a5490e15f25ebab7bb2a200a8417a950818069eb8248b6:8775:8903|blur`; placement=placement:e2e4cd91bbc40955b89fb10f; conditions=children == null:falsy

## client/src/components/Chat/Messages/Content/Parts/ToolArtifactCard.tsx (1)

### ToolArtifactCard — chat message surface (1)

- route: unavailable
- `function:cc6ac5792d71e8da5abb4a9ba810eba041570cb6173e54a29c7cf737698703e1:9699:10014|click`; placement=placement:a829fb4c95ed929ba0804eb7; conditions=claim != null && !isMyClaim:falsy

## client/src/components/Chat/Messages/Content/SiblingHeader.tsx (1)

### SiblingHeader — chat message surface (1)

- route: unavailable
- `function:76039fce4ed29dbbcb266a9786a57986f53d47767c80f6ba3731a997e3ba5ec9:1827:1985|click`; placement=placement:887eca3c462edb4b4da04b44; conditions=none

## client/src/components/Chat/Messages/Content/ToolApproval.tsx (1)

### Button — agent builder (1)

- route: unavailable
- `function:ffa9b80e4cb8caa7b3b9171b066612aa3644bbfd3b58dff4778e945c834d0b0c:8377:8411|click`; placement=placement:7ff065e278c00df5641ce074; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:truthy; !toolCall:falsy; isToolCall:truthy; toolCall.approval != null && (toolCall.output?.length ?? 0) === 0:truthy; status === 'submitted':falsy; isLead:truthy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.TOOL_CALL:truthy; !tc:falsy; tc.approval != null && (tc.output?.length ?? 0) === 0:truthy; status === 'submitted':falsy; isLead:truthy

## client/src/components/Chat/Messages/Content/ToolCall.tsx (1)

### Button — files and previews (1)

- route: unavailable
- `function:c472fe7c6f29cd7e1dfb63a8e5221ca028a8114d4a05197f5ade233c2104fe62:3888:4280|click`; placement=placement:35ac257f5c46eb575d194f21; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:truthy; !toolCall:falsy; isToolCall:falsy; toolCall.type === ToolCallTypes.CODE_INTERPRETER:falsy; toolCall.type === ToolCallTypes.RETRIEVAL ||
      toolCall.type === ToolCallTypes.FILE_SEARCH:falsy; toolCall.type === ToolCallTypes.FUNCTION &&
      ToolCallTypes.FUNCTION in toolCall &&
      imageGenTools.has(toolCall.function.name):falsy; toolCall.type === ToolCallTypes.FUNCTION && ToolCallTypes.FUNCTION in toolCall:truthy; isImageVisionTool(toolCall):falsy; !isLast && (!function_name || function_name.length === 0) && !output:falsy; auth != null && auth && progress < 1 && !showCancelled:truthy

## client/src/components/Chat/Messages/Content/ToolCallGroup.tsx (1)

### ToolCallGroup — chat message surface (1)

- route: unavailable
- `function:5504deea9adb63a8946d4a51904010689e0c3e4c900858b42e5a3e4dfd0cede1:10194:10441|click`; placement=placement:b7ebadea3e5acc69d2e6c395; conditions=none

## client/src/components/Chat/Messages/Content/ToolCallInfo.tsx (1)

### ToolCallInfo — files and previews (1)

- route: unavailable
- `function:20aab4a31e88aa9e4aa9aae6d51adf2a52014e38a168a102d9be444d1b2a0db8:4810:4846|click`; placement=placement:61a2ac7d2e75b9f019d009a8; conditions=!part:falsy; askUserQuestion:falsy; part.type === ContentTypes.STEER:falsy; part.type === ContentTypes.ERROR:falsy; part.type === ContentTypes.AGENT_UPDATE:falsy; part.type === ContentTypes.TEXT:falsy; part.type === ContentTypes.THINK:falsy; part.type === ContentTypes.SUMMARY:falsy; part.type === ContentTypes.ACTIVITY_LABEL:falsy; part.type === ContentTypes.TOOL_CALL:truthy; !toolCall:falsy; isToolCall:falsy; toolCall.type === ToolCallTypes.CODE_INTERPRETER:falsy; toolCall.type === ToolCallTypes.RETRIEVAL ||
      toolCall.type === ToolCallTypes.FILE_SEARCH:falsy; toolCall.type === ToolCallTypes.FUNCTION &&
      ToolCallTypes.FUNCTION in toolCall &&
      imageGenTools.has(toolCall.function.name):falsy; toolCall.type === ToolCallTypes.FUNCTION && ToolCallTypes.FUNCTION in toolCall:truthy; isImageVisionTool(toolCall):falsy; !isLast && (!function_name || function_name.length === 0) && !output:falsy; hasInfo:truthy; hasParams:truthy

## client/src/components/Chat/Messages/Content/ToolOutput/OutputRenderer.tsx (2)

### OutputRenderer — chat message surface (2)

- route: unavailable
- `function:ab7a6941301388f3641ffa3be6b1b459432c2d0b3ea468e442e30526ac62beb3:4642:4678|click`; placement=placement:2322f42745c387858284eec0; conditions=!displayText:falsy; needsTruncation:truthy
- `function:ab7a6941301388f3641ffa3be6b1b459432c2d0b3ea468e442e30526ac62beb3:5070:5112|click`; placement=placement:2322f42745c387858284eec0; conditions=!displayText:falsy; error && rawError && rawError !== displayText:truthy

## client/src/components/Chat/Messages/Content/UIResourceCarousel.tsx (2)

### UIResourceCarousel — chat message surface (2)

- route: unavailable
- `function:ad821751b4fa41e747f9038d13f202748788e406e29aa01d601f0fd1d2b22ee4:2682:2702|click`; placement=placement:959ba7609f40b24ab4543017; conditions=uiResources.length === 0:falsy; showLeftArrow:truthy
- `function:ad821751b4fa41e747f9038d13f202748788e406e29aa01d601f0fd1d2b22ee4:4552:4573|click`; placement=placement:959ba7609f40b24ab4543017; conditions=uiResources.length === 0:falsy; showRightArrow:truthy

## client/src/components/Chat/Messages/Content/WebSearch.tsx (1)

### WebSearch — chat message surface (1)

- route: unavailable
- `function:ed8e494c7f4f26b7ab81db1b2f7bbef317e9ba2a12ae80b3722f049b84d4e2f6:6842:6988|click`; placement=placement:9f42a95f5709cbc56872f7a4; conditions=cancelled:falsy; complete:truthy

## client/src/components/Chat/Messages/MessageNav.tsx (9)

### MessageNav — chat message surface (8)

- route: unavailable
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:16700:16792|click`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:18270:20046|pointerdown`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy; endEntry:truthy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:24002:24070|focus`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy; endEntry:truthy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:24137:24334|blur`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy; endEntry:truthy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:26855:27369|focus`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:27441:27676|blur`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:36985:37655|click`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:37749:38358|click`; placement=placement:a2ea717827c22ad3cdd916f2; conditions=messageEntries.length < 3:falsy

### MessageIndicator — chat message surface (1)

- route: unavailable
- `function:b57bb8c6c0e41a4971af646bb9d1bc557bc94b46996cd0a8d493326cf472617b:7335:7408|click`; placement=placement:31a560c8a10eaf2a2ce777ba; conditions=none

## client/src/components/Chat/Messages/MinimalHoverButtons.tsx (1)

### MinimalHoverButtons — chat message surface (1)

- route: unavailable
- `function:ca3631ae0a83c190bbe300932d93fa76308bdf956ac797e242f0e1a36e4abc31:1142:1176|click`; placement=placement:c9b8fe7387bb0bfaf9c5800e; conditions=!message:falsy; (_messagesTree && _messagesTree.length === 0) || _messagesTree === null:falsy; !(messagesTree && messagesTree.length):falsy; !message:falsy; !message:falsy; !message:falsy

## client/src/components/Chat/Messages/SearchButtons.tsx (1)

### SearchButtons — conversation list or menu (1)

- route: unavailable
- `function:266ed5994412e263969373eccdb859fe7b2d7aea6404ed2fc2f31615cc32bce2:844:1644|click`; placement=placement:9550bb7193ea3ee9245e2369; conditions=!message:falsy; !conversationId:falsy

## client/src/components/Conversations/ConvoOptions/ConvoOptions.tsx (2)

### ConvoOptions — conversation list or menu (2)

- route: unavailable
- `function:3bba1791a3fdf183ba30c32c208c672d1070797fec38692102eb25c78f597bf8:5423:5889|click`; placement=placement:7f893290b90df450c35852f9; conditions=isShiftHeld && isActiveConvo && !isPopoverActive && !showShareDialog && !showDeleteDialog:truthy
- `function:3bba1791a3fdf183ba30c32c208c672d1070797fec38692102eb25c78f597bf8:5994:6919|click`; placement=placement:7f893290b90df450c35852f9; conditions=isShiftHeld && isActiveConvo && !isPopoverActive && !showShareDialog && !showDeleteDialog:truthy

## client/src/components/Conversations/ConvoOptions/DeleteButton.tsx (1)

### Button — conversation list or menu (1)

- route: unavailable
- `function:3dace8c0d4accdb10fae5d6fa1c4ebfae91dc12defb5c15125de63e5c908766f:2331:2656|click`; placement=placement:9abf8ecf1f6f4d813f310c94; conditions=none

## client/src/components/Conversations/ConvoOptions/ProjectButton.tsx (3)

### Button — conversation list or menu (1)

- route: unavailable
- `function:6ad4d60b462e8d5ab6368aca90724f6d80d601743f7ce2da87de4aa8c4a9c2f6:1697:2344|click`; placement=placement:9b107fe43404917d12c24d1b; conditions=none

### ProjectConversationDialog — conversation list or menu (2)

- route: unavailable
- `function:6ad4d60b462e8d5ab6368aca90724f6d80d601743f7ce2da87de4aa8c4a9c2f6:2799:2850|change`; placement=placement:8bdd34672c74686c92b3d5cd; conditions=none
- `function:6ad4d60b462e8d5ab6368aca90724f6d80d601743f7ce2da87de4aa8c4a9c2f6:3435:3456|click`; placement=placement:8bdd34672c74686c92b3d5cd; conditions=hasNextPage:truthy

## client/src/components/Conversations/ProjectsSection.tsx (1)

### ProjectItem — conversation list or menu (1)

- route: unavailable
- `function:20cee0ec525c973a74095f553d3eb83969ddfb1294a1ab3c0fec0f617633deea:10706:10740|click`; placement=placement:199293e4304d5e2538ea9785; conditions=none

## client/src/components/Conversations/RenameForm.tsx (4)

### RenameForm — conversation list or menu (4)

- route: unavailable
- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1312:1348|change`; placement=placement:55061f1361c1666a75712795; conditions=renaming:truthy
- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1565:1581|click`; placement=placement:55061f1361c1666a75712795; conditions=renaming:truthy
- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:1876:1902|click`; placement=placement:55061f1361c1666a75712795; conditions=renaming:truthy
- `function:348389e6924deb31f91c5d32cce54049ff9abb71061655c299e6cfc4957e1491:671:897|keydown`; placement=placement:55061f1361c1666a75712795; conditions=renaming:truthy

## client/src/components/Endpoints/Settings/Google.tsx (1)

### Input — settings tabs (1)

- route: unavailable
- `function:c56932cefdf32a5a5abf2055cd8e066ddedf9ce35400995b10babe088faef4cf:2688:2732|change`; placement=placement:be7d65fd8068b913ae64a270; conditions=!conversation:falsy; showExamples && isChatModel && !isTextModel:falsy; !conversation:falsy

## client/src/components/Files/FileDashboardView.tsx (1)

### Button — files and previews (1)

- route: unavailable
- `function:0475bb72f9319e08d00ae3af4c702d3b512b61f78f37a0bb4e7fb28b8fd90055:587:638|click`; placement=placement:730adebc2d4860bb00cd1d01; conditions=params.vectorStoreId:truthy

## client/src/components/Files/FileList/DataTableFile.tsx (6)

### Button — files and previews (5)

- route: unavailable
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:10285:10307|click`; placement=placement:146ed811cade07628854aaa8; conditions=none
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:3051:3112|click`; placement=placement:9232fd9d6dfd954ff6103feb; conditions=none
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:3202:3520|click`; placement=placement:ab283a03b7e2165d0578cfbd; conditions=none
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:5640:5666|click`; placement=placement:204d1781e9939cf41e521b55; conditions=none
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:9995:10021|click`; placement=placement:623369e5226cefb5575e2aee; conditions=none

### Input — files and previews (1)

- route: unavailable
- `function:3c0557431880619bd5e7e204ef14c519d041871e24d601dbf4b4caf567aa8a7b:5422:5496|change`; placement=placement:63948b341eb2709247a56aae; conditions=none

## client/src/components/Files/FileList/FileListItem.tsx (1)

### Button — files and previews (1)

- route: unavailable
- `function:8e925481b2035a3cc0de6c4fb5e41440d25d6d0adb47c15754600b963fe8f92e:1038:1064|click`; placement=placement:c472cc0390e0b217c5cf8287; conditions=none

## client/src/components/Files/FileList/FileListItem2.tsx (2)

### Button — files and previews (1)

- route: unavailable
- `function:56dc297e78b3a4fb1a73954ad68a143f1196dccb7dcf48736ae456d4c9b7c25d:2418:2444|click`; placement=placement:b164f7cf1ebeb1bd1b875d43; conditions=none

### FileListItem2 — files and previews (1)

- route: unavailable
- `function:56dc297e78b3a4fb1a73954ad68a143f1196dccb7dcf48736ae456d4c9b7c25d:564:615|click`; placement=placement:407c5f0b242b29e776f5839c; conditions=none

## client/src/components/Files/FileList/FilePreview.tsx (2)

### Button — files and previews (2)

- route: unavailable
- `function:c32a085d693ec0b4b1e2903b72e473277ddb63c6ac4872af4b1f544d2a0c5634:2256:2317|click`; placement=placement:bb6a6f7345c655205d1cf554; conditions=none
- `function:c32a085d693ec0b4b1e2903b72e473277ddb63c6ac4872af4b1f544d2a0c5634:2438:2499|click`; placement=placement:2ec4f7706763b54a15688afc; conditions=none

## client/src/components/Files/FileList/FileSidePanel.tsx (2)

### Input — files and previews (1)

- route: unavailable
- `function:0c255a81fd40d0536a91a5cb819a482b5157383bdf1fd8aab23e866f1260a933:3666:3725|change`; placement=placement:669a1ab5f8fd72f9aace0218; conditions=none

### Button — files and previews (1)

- route: unavailable
- `function:0c255a81fd40d0536a91a5cb819a482b5157383bdf1fd8aab23e866f1260a933:3921:3979|click`; placement=placement:f9c483587609667ea48f3605; conditions=none

## client/src/components/Files/FilesListView.tsx (1)

### Button — files and previews (1)

- route: unavailable
- `function:e1ad42af472e990080e15f6da3d2bd1246d046837fad6a6764e288e4bd545b64:769:826|click`; placement=placement:b239bd12b6d7733f503c83c6; conditions=params.fileId != null && params.fileId:truthy

## client/src/components/Files/FilesSectionSelector.tsx (2)

### Button — files and previews (2)

- route: unavailable
- `function:00a5704415faedb561f3dd76ae63d1d714935005b7e7bd2a5dab52fac5025879:1307:1397|click`; placement=placement:b0011b695c83d7386128a5ef; conditions=none
- `function:00a5704415faedb561f3dd76ae63d1d714935005b7e7bd2a5dab52fac5025879:925:1031|click`; placement=placement:a7e2fe4ddbe957f993d31d9c; conditions=none

## client/src/components/Files/VectorStore/VectorStoreListItem.tsx (2)

### Button — files and previews (1)

- route: unavailable
- `function:5c4e2864dd5d55fa6b501df1b4379fc6527ce6617a01d95716825341dc0845d1:1679:1719|click`; placement=placement:a42ef5fbc9ccf613526a4a0f; conditions=none

### VectorStoreListItem — files and previews (1)

- route: unavailable
- `function:5c4e2864dd5d55fa6b501df1b4379fc6527ce6617a01d95716825341dc0845d1:547:596|click`; placement=placement:c137dd9a8357631300302b0b; conditions=none

## client/src/components/Files/VectorStore/VectorStorePreview.tsx (2)

### Button — files and previews (2)

- route: unavailable
- `function:945f9a87afab4bd2681e9d7d88a89e6832ec51471a72618225da7e298013c0d2:2909:2970|click`; placement=placement:21bbbfb9a4a65fe1b085d149; conditions=none
- `function:945f9a87afab4bd2681e9d7d88a89e6832ec51471a72618225da7e298013c0d2:3073:3127|click`; placement=placement:1069ce3db25e3e66b2fb8984; conditions=none

## client/src/components/Files/VectorStore/VectorStoreSidePanel.tsx (2)

### Input — files and previews (1)

- route: unavailable
- `function:900d70774a3b22f4536464db0fc09395340e359e12b9c4a1f45120a9727cd12d:4766:4829|change`; placement=placement:a9b91fa204c174107972467b; conditions=none

### Button — files and previews (1)

- route: unavailable
- `function:900d70774a3b22f4536464db0fc09395340e359e12b9c4a1f45120a9727cd12d:5038:5110|click`; placement=placement:d19c03c6ed129529c416d2f0; conditions=none

## client/src/components/Files/VectorStoreView.tsx (1)

### Button — files and previews (1)

- route: unavailable
- `function:4d4db847787857822a18476b1eea9415d9bd918a895b659e683f67a7b76410e3:679:740|click`; placement=placement:8d417e51286fc29b3c4cfb60; conditions=none

## client/src/components/MCP/CustomUserVarsSection.tsx (3)

### Button — other authenticated surface (2)

- route: unavailable
- `function:0efbfb1c1bd3cdf2db8b18846e78e6f2fa2c669f9d6b0c921758c7a9b331e794:4933:4990|click`; placement=placement:9da7d5731c7f4b7ae4d5d654; conditions=!fields || Object.keys(fields).length === 0:falsy
- `function:0efbfb1c1bd3cdf2db8b18846e78e6f2fa2c669f9d6b0c921758c7a9b331e794:5021:5061|click`; placement=placement:5fa21a6d1fa9452077237b50; conditions=!fields || Object.keys(fields).length === 0:falsy

### CustomUserVarsSection — other authenticated surface (1)

- route: unavailable
- `function:0efbfb1c1bd3cdf2db8b18846e78e6f2fa2c669f9d6b0c921758c7a9b331e794:4933:4990|submit`; placement=placement:3d50c431a75ee5a31a0567a0; conditions=!fields || Object.keys(fields).length === 0:falsy

## client/src/components/MCP/MCPServerMenuItem.tsx (2)

### MCPServerMenuItem — other authenticated surface (2)

- route: unavailable
- `function:570ff7265315f3f4420f41c015cdbfe87410eaf348512f9d1888a1707a4e61a0:1700:1733|click`; placement=placement:4433296e8ca3626197620509; conditions=none
- `function:570ff7265315f3f4420f41c015cdbfe87410eaf348512f9d1888a1707a4e61a0:3408:3434|click`; placement=placement:4433296e8ca3626197620509; conditions=showActionButton && statusIconProps:truthy

## client/src/components/MCP/ServerInitializationSection.tsx (5)

### Button — authentication route (5)

- route: unavailable
- `function:bfb5ea621af55c598f917d538373ba54c5636c19825d4bd2b7d4efda490dc9bc:1801:1834|click`; placement=placement:0ecf1795ab49d77e3011b75e; conditions=!shouldShowReinit && !shouldShowInit && !serverOAuthUrl:truthy; !hasPendingOAuth:falsy
- `function:bfb5ea621af55c598f917d538373ba54c5636c19825d4bd2b7d4efda490dc9bc:2170:2203|click`; placement=placement:cbdf1097e2c24f48ed5a8ecb; conditions=!shouldShowReinit && !shouldShowInit && !serverOAuthUrl:falsy; serverOAuthUrl:truthy
- `function:bfb5ea621af55c598f917d538373ba54c5636c19825d4bd2b7d4efda490dc9bc:2465:2531|click`; placement=placement:cd2ce4574d5dd0bf4148459c; conditions=!shouldShowReinit && !shouldShowInit && !serverOAuthUrl:falsy; serverOAuthUrl:truthy
- `function:bfb5ea621af55c598f917d538373ba54c5636c19825d4bd2b7d4efda490dc9bc:3469:3507|click`; placement=placement:69f8ecdc4fe5b7d813c4be09; conditions=!shouldShowReinit && !shouldShowInit && !serverOAuthUrl:falsy; serverOAuthUrl:falsy; requiresOAuth && revokeOAuthForServer:truthy
- `function:bfb5ea621af55c598f917d538373ba54c5636c19825d4bd2b7d4efda490dc9bc:3737:3778|click`; placement=placement:9a4ecf4a955121845d5b9732; conditions=!shouldShowReinit && !shouldShowInit && !serverOAuthUrl:falsy; serverOAuthUrl:falsy

## client/src/components/Messages/Content/CodeBlock.tsx (4)

### CodeBlock — chat message surface (2)

- route: unavailable
- `function:93c361dd3a778b7c329bd2d1add9832e5df295f04f3951166455b82b6b115a38:2170:2194|focus`; placement=placement:fe3cb858ff890c3941da1d61; conditions=lang === 'math':falsy; lang === 'mermaid':falsy; isSingleLineCode(children):falsy; isMath:falsy; isMermaid:falsy; isSingleLine:falsy
- `function:93c361dd3a778b7c329bd2d1add9832e5df295f04f3951166455b82b6b115a38:2235:2366|blur`; placement=placement:fe3cb858ff890c3941da1d61; conditions=lang === 'math':falsy; lang === 'mermaid':falsy; isSingleLineCode(children):falsy; isMath:falsy; isMermaid:falsy; isSingleLine:falsy

### ResultSwitcher — chat message surface (2)

- route: unavailable
- `function:93c361dd3a778b7c329bd2d1add9832e5df295f04f3951166455b82b6b115a38:2726:2844|click`; placement=placement:74229bbef681db6371c47e61; conditions=lang === 'math':falsy; lang === 'mermaid':falsy; isSingleLineCode(children):falsy; allowExecution === true && toolCalls && toolCalls.length > 0:truthy; toolCalls.length > 1:truthy; totalCount <= 1:falsy; isMath:falsy; isMermaid:falsy; isSingleLine:falsy; allowExecution === true && toolCalls && toolCalls.length > 0:truthy; toolCalls.length > 1:truthy; totalCount <= 1:falsy
- `function:93c361dd3a778b7c329bd2d1add9832e5df295f04f3951166455b82b6b115a38:2906:2992|click`; placement=placement:86ee3b904f6f03946d85b481; conditions=isMath:falsy; isMermaid:falsy; isSingleLine:falsy; allowExecution === true && toolCalls && toolCalls.length > 0:truthy; toolCalls.length > 1:truthy; totalCount <= 1:falsy; lang === 'math':falsy; lang === 'mermaid':falsy; isSingleLineCode(children):falsy; allowExecution === true && toolCalls && toolCalls.length > 0:truthy; toolCalls.length > 1:truthy; totalCount <= 1:falsy

## client/src/components/Messages/Content/Mermaid/Mermaid.tsx (4)

### Mermaid — chat message surface (4)

- route: unavailable
- `function:a28d0c03450a8a128c8ab80abc202687a17b58c5b550396e6b6f45a1294ea692:2016:2055|click`; placement=placement:7991a04661a82bb510090668; conditions=isLoading:falsy; error:truthy
- `function:a28d0c03450a8a128c8ab80abc202687a17b58c5b550396e6b6f45a1294ea692:2180:2444|click`; placement=placement:7991a04661a82bb510090668; conditions=isLoading:truthy; lastValidSvgRef.current && blobUrl:truthy
- `function:a28d0c03450a8a128c8ab80abc202687a17b58c5b550396e6b6f45a1294ea692:2722:2750|focus`; placement=placement:7991a04661a82bb510090668; conditions=isLoading:truthy; lastValidSvgRef.current && blobUrl:truthy
- `function:a28d0c03450a8a128c8ab80abc202687a17b58c5b550396e6b6f45a1294ea692:2764:2901|blur`; placement=placement:7991a04661a82bb510090668; conditions=isLoading:truthy; lastValidSvgRef.current && blobUrl:truthy

## client/src/components/Nav/Favorites/FavoriteItem.tsx (3)

### FavoriteItem — bookmarks panel (3)

- route: unavailable
- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:2076:2234|click`; placement=placement:cf329f0baa5c1e2f3040faa9; conditions=none
- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:2261:2394|keydown`; placement=placement:cf329f0baa5c1e2f3040faa9; conditions=none
- `function:af03458daa4b3157d94bbc93a13e2591c629e8215bf67cb31b81f0f84661b5b3:5363:5389|click`; placement=placement:cf329f0baa5c1e2f3040faa9; conditions=none

## client/src/components/Nav/Favorites/FavoritesList.tsx (2)

### FavoritesList — bookmarks panel (2)

- route: unavailable
- `function:8a5dd402fcbf94410898bffd0c1ebe4d57673e1efbb606da70fa84f55cd95475:12815:13007|keydown`; placement=placement:ffab5faa0a61a41997d58d3f; conditions=search.query:falsy; !isFavoritesLoading && safeFavorites.length === 0 && !showAgentMarketplace:falsy; isFavoritesLoading:falsy; isAgentsLoading:falsy; showAgentMarketplace:truthy
- `function:8a5dd402fcbf94410898bffd0c1ebe4d57673e1efbb606da70fa84f55cd95475:6176:6275|click`; placement=placement:ffab5faa0a61a41997d58d3f; conditions=search.query:falsy; !isFavoritesLoading && safeFavorites.length === 0 && !showAgentMarketplace:falsy; isFavoritesLoading:falsy; isAgentsLoading:falsy; showAgentMarketplace:truthy

## client/src/components/Nav/KeyboardShortcutsDialog.tsx (3)

### ShortcutRow — keyboard shortcuts dialog (3)

- route: unavailable
- `function:1d7093eafa96ba005395ee16b794960037326baf10ffe062cdc1e43a76712cd8:4055:4082|click`; placement=placement:2843b71cf113ed9886c39045; conditions=isEditing:falsy; info.isCustom:truthy
- `function:1d7093eafa96ba005395ee16b794960037326baf10ffe062cdc1e43a76712cd8:4491:4517|click`; placement=placement:2843b71cf113ed9886c39045; conditions=isEditing:falsy; isUnset:truthy
- `function:1d7093eafa96ba005395ee16b794960037326baf10ffe062cdc1e43a76712cd8:5208:5234|click`; placement=placement:2843b71cf113ed9886c39045; conditions=isEditing:falsy; isUnset:falsy

## client/src/components/Nav/SearchBar.tsx (6)

### SearchBar — other authenticated surface (6)

- route: unavailable
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:1941:2145|keyup`; placement=placement:6a264472d79f80c93f3b389b; conditions=none
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:2668:3063|change`; placement=placement:6a264472d79f80c93f3b389b; conditions=none
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:4399:4476|keydown`; placement=placement:6a264472d79f80c93f3b389b; conditions=none
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:4693:4757|focus`; placement=placement:6a264472d79f80c93f3b389b; conditions=none
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:4775:4840|blur`; placement=placement:6a264472d79f80c93f3b389b; conditions=none
- `function:7887a0ded8433d03310c3badfe24e277c14c0c60a189f2eb105c0958a2294fa4:5299:5333|click`; placement=placement:6a264472d79f80c93f3b389b; conditions=none

## client/src/components/Nav/Settings/Sidebar.tsx (1)

### Sidebar — settings tabs (1)

- route: unavailable
- `function:7e6774488daa285c8b009f4e9e0ae5fa9cee14c107ed3180f6030ce06f0a42a8:1725:1748|click`; placement=placement:cac3f2da1be8b8a2ce932df8; conditions=query.length > 0:truthy

## client/src/components/Nav/SettingsTabs/Account/TwoFactorPhases/DisablePhase.tsx (2)

### Button — settings tabs (1)

- route: unavailable
- `function:3e986eba176b0429be1a0f000838e0dd999bf302edc08cddc8c940a1704ff947:2206:2239|click`; placement=placement:81bf63daf84136316e7ec98a; conditions=none

### DisablePhase — settings tabs (1)

- route: unavailable
- `function:3e986eba176b0429be1a0f000838e0dd999bf302edc08cddc8c940a1704ff947:2590:2620|click`; placement=placement:77842da9fc890feb5d5f3c9e; conditions=none

## client/src/components/Nav/SettingsTabs/ApiKeys/Create.tsx (2)

### Create — settings tabs (1)

- route: unavailable
- `function:c017d10c094c96d1dd65aa537ac367527067431ce4e484f0728de30511e578c8:1044:1545|submit`; placement=placement:0427c625b62217250128d890; conditions=none

### Input — settings tabs (1)

- route: unavailable
- `function:c017d10c094c96d1dd65aa537ac367527067431ce4e484f0728de30511e578c8:1976:2111|change`; placement=placement:2141015126871205df815075; conditions=none

## client/src/components/Nav/SettingsTabs/ApiKeys/Item.tsx (1)

### Button — settings tabs (1)

- route: unavailable
- `function:de32e289ff53acf7028b39005fdc2c3e7c7b06a9d477ea1667fe082b6795ed93:2685:2710|click`; placement=placement:b98a2907feab0f76fd4cc099; conditions=none

## client/src/components/Nav/SettingsTabs/ApiKeys/List.tsx (1)

### Button — settings tabs (1)

- route: unavailable
- `function:f9711be4a72e87b0de881301fcafbcf1992221027fe6c8c9fdd2b90c6f7c6d06:1089:1104|click`; placement=placement:7e3bd67210444f3677df8c3d; conditions=isLoading:falsy; isError && data == null:truthy

## client/src/components/Nav/SettingsTabs/Chat/ChatDirection.tsx (1)

### Button — settings tabs (1)

- route: unavailable
- `function:493913766e56d0734523f1291a56cefbf56f279c542d15d58079ac7478c2a561:349:422|click`; placement=placement:dba2bade18dd98c277bd1dfc; conditions=none

## client/src/components/Nav/SettingsTabs/Integrations/LangfuseConnection.tsx (8)

### Button — settings tabs (4)

- route: unavailable
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:12727:13875|click`; placement=placement:903a73987fe577fec059b24c; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; isEditing:falsy
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:14634:14659|click`; placement=placement:c60d22cd7d17a90ec3e9f661; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:truthy
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:8602:9549|click`; placement=placement:c58b5cd422aaf0aed480a3f3; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; isEditing:truthy
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:9575:11088|click`; placement=placement:d30043109d37880a83ecc519; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; isEditing:truthy

### LangfuseConnection — settings tabs (2)

- route: unavailable
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:17719:17752|click`; placement=placement:db6b62a8a05e9890a0a97675; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; secretConfigured && !isEditingPublicKey:truthy
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:19449:19482|click`; placement=placement:db6b62a8a05e9890a0a97675; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; secretConfigured && !isEditingSecretKey:truthy

### Input — settings tabs (1)

- route: unavailable
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:18350:18827|change`; placement=placement:c8e805469ef95e3e3020c38c; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; publicKeyInputVisible:truthy

### SecretInput — settings tabs (1)

- route: unavailable
- `function:8d4d23fb5b1b52491d52d28b98ff9fb7fb0a0f600873c911deabfa488d7203f5:20102:20317|change`; placement=placement:6932430ce148ecf4f8807301; conditions=isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; secretInputVisible:truthy

## client/src/components/Nav/SettingsTabs/ProviderKeys/ProviderKeyRow.tsx (1)

### Button — settings tabs (1)

- route: unavailable
- `function:badab2b989ece937ae7aeb9b8411b7e7b7adaa28a2bb5ea6976bf2fab2a7c8e5:2302:2327|click`; placement=placement:012214786161f81d0b6232a6; conditions=none

## client/src/components/Nav/ShortcutRecorder.tsx (1)

### RecorderInfo — keyboard shortcuts dialog (1)

- route: unavailable
- `function:71879adb0dc12db320fbfc53b15c4ebc76278cd07eea35a8bede1b58c02a4586:6575:6635|click`; placement=placement:41023a55e4e0d4e44bdf4455; conditions=hasConflict && conflict:truthy; isEditing:truthy; hasConflict && conflict:truthy

## client/src/components/OAuth/OAuthError.tsx (1)

### OAuthError — authentication route (1)

- route: unavailable
- `function:0a85cbb0c31653efc5196bcc0a7cfd7c821318dc7d5471c0a973e610c2988064:2217:2237|click`; placement=placement:4496fc0c72d17786a99e8261; conditions=none

## client/src/components/Plugins/Store/PluginAuthForm.tsx (2)

### Button — marketplace details (1)

- route: unavailable
- `function:267e726c108bf75a014cf75937e00e0e3125e636a146ac36b999916e60eb9ab4:3403:3533|click`; placement=placement:ad03bb3b62cc3ebb0765e96b; conditions=item.kind === 'builtin':falsy; item.kind === 'tool':truthy; showForm:truthy

### PluginAuthForm — marketplace details (1)

- route: unavailable
- `function:267e726c108bf75a014cf75937e00e0e3125e636a146ac36b999916e60eb9ab4:3403:3533|submit`; placement=placement:3d9066f4c902f7806c4f146b; conditions=item.kind === 'builtin':falsy; item.kind === 'tool':truthy; showForm:truthy

## client/src/components/Plugins/Store/PluginPagination.tsx (4)

### PluginPagination — marketplace details (4)

- route: unavailable
- `function:bdd5f8c70167a52054cbe0af51dad6e14bfd6a691390067ec7656b5e064cd766:2448:2487|click`; placement=placement:812695b0b6519b37659f0c9a; conditions=none
- `function:bdd5f8c70167a52054cbe0af51dad6e14bfd6a691390067ec7656b5e064cd766:2508:2633|keydown`; placement=placement:812695b0b6519b37659f0c9a; conditions=none
- `function:bdd5f8c70167a52054cbe0af51dad6e14bfd6a691390067ec7656b5e064cd766:720:759|click`; placement=placement:812695b0b6519b37659f0c9a; conditions=none
- `function:bdd5f8c70167a52054cbe0af51dad6e14bfd6a691390067ec7656b5e064cd766:780:905|keydown`; placement=placement:812695b0b6519b37659f0c9a; conditions=none

## client/src/components/Projects/ProjectChatList.tsx (1)

### ConversationRow — conversation list or menu (1)

- route: unavailable
- `function:dfcf7a4ec1c81feda318c946819ce72f02bf686bc9b0308df1440ddc2186977e:2978:3013|click`; placement=placement:87d50ebdf013de0a10a4daeb; conditions=none

## client/src/components/Projects/ProjectsView.tsx (3)

### Button — projects surface (2)

- route: unavailable
- `function:4bcf6f448d90de90f942c36a8b20b8ef707fd443a325143901129cfac038ba0f:10108:10129|click`; placement=placement:85bcd0a703b2315ca1980815; conditions=hasNextPage:truthy
- `function:4bcf6f448d90de90f942c36a8b20b8ef707fd443a325143901129cfac038ba0f:6141:6166|click`; placement=placement:c70f71abe824dbd4150b20fd; conditions=none

### Input — projects surface (1)

- route: unavailable
- `function:4bcf6f448d90de90f942c36a8b20b8ef707fd443a325143901129cfac038ba0f:6770:6810|change`; placement=placement:b3f9eb3707a2bd4add631f9c; conditions=none

## client/src/components/Projects/ProjectWorkspace.tsx (2)

### ProjectWorkspace — projects surface (2)

- route: unavailable
- `function:151efc0f126d7f1ffec2b4a5b40eb3bfdfe15d8014a2b5a5e720b7c8baedd4e1:3564:3818|click`; placement=placement:43b18320e022bad22cac84aa; conditions=isProjectLoading:falsy; !project:falsy
- `function:151efc0f126d7f1ffec2b4a5b40eb3bfdfe15d8014a2b5a5e720b7c8baedd4e1:4551:4578|click`; placement=placement:43b18320e022bad22cac84aa; conditions=isProjectLoading:falsy; !project:falsy

## client/src/components/Prompts/display/PromptActions.tsx (1)

### Button — prompts editor (1)

- route: unavailable
- `function:e9666b635f2bd093b7bbeba3e5fbecfa7c44ce3ff9979f98c9b53465cabe3de2:1038:1243|click`; placement=placement:1f95fb8f3bc0532cbbde70a4; conditions=!hasAccess:falsy; isNew && !hasCreateAccess:falsy; isNew:falsy; initialLoad:falsy; !canEdit && !permissionsLoading && groupsQuery?.data:truthy; !fetchedPrompt && !canView:falsy; fetchedPrompt || group:truthy; !group:falsy; showActions:truthy

## client/src/components/Prompts/editor/PromptEditor.tsx (1)

### PromptEditor — prompts editor (1)

- route: unavailable
- `function:93232ff2dd74dde9e61a272f78521c4b86f216703c50eedddfcf132b76d49ffb:2851:2875|click`; placement=placement:5afb0437ca4aa7770773a8ae; conditions=!isEditing:truthy

## client/src/components/Prompts/fields/Command.tsx (1)

### Input — prompts editor (1)

- route: unavailable
- `function:ca5cca825c8c376313f9cbb6a3f748c95cb76b251a2f136186becd7366d45b6b:863:1125|change`; placement=placement:b1dff55fa7d6d96cf7169cd4; conditions=disabled === true && !command:falsy

## client/src/components/Prompts/fields/Description.tsx (1)

### Input — prompts editor (1)

- route: unavailable
- `function:0a1067aed04de7c54a7fd211df470518455c0ae818d724e8935a9d58af7d9841:852:994|change`; placement=placement:330839039fae10e239a5f69e; conditions=disabled && !description:falsy

## client/src/components/Prompts/fields/PromptName.tsx (4)

### PromptName — prompts editor (4)

- route: unavailable
- `function:66d6caef31ca722e3a4f5731bd7c03a47e8231ba4b2d81451c9bae1e3c149356:1373:1488|blur`; placement=placement:bebd96481ea010b6a841d8dc; conditions=isEditing:truthy
- `function:66d6caef31ca722e3a4f5731bd7c03a47e8231ba4b2d81451c9bae1e3c149356:1547:1999|keydown`; placement=placement:bebd96481ea010b6a841d8dc; conditions=isEditing:truthy
- `function:66d6caef31ca722e3a4f5731bd7c03a47e8231ba4b2d81451c9bae1e3c149356:3559:3683|click`; placement=placement:bebd96481ea010b6a841d8dc; conditions=isEditing:falsy
- `function:66d6caef31ca722e3a4f5731bd7c03a47e8231ba4b2d81451c9bae1e3c149356:974:1055|change`; placement=placement:bebd96481ea010b6a841d8dc; conditions=isEditing:truthy

## client/src/components/Prompts/forms/PromptForm.tsx (1)

### Button — prompts editor (1)

- route: unavailable
- `function:92d68b8b4bf499444e268eb352d48c632b890b834a7aa0aafd97f34e62d3b6b9:3013:3379|click`; placement=placement:7c4b7298e2a5f8dccc0a397f; conditions=canEdit:truthy

## client/src/components/Prompts/forms/PromptLabelsForm.tsx (2)

### Input — prompts editor (2)

- route: unavailable
- `function:0e46e06a569e0c56ba1886b3c552f393ec82d5e33deebcc66b5d477128a43973:602:686|change`; placement=placement:340e44138674ae67a0201ca3; conditions=none
- `function:0e46e06a569e0c56ba1886b3c552f393ec82d5e33deebcc66b5d477128a43973:713:1215|keydown`; placement=placement:340e44138674ae67a0201ca3; conditions=none

## client/src/components/Prompts/forms/VariableForm.tsx (1)

### VariableForm — prompts editor (1)

- route: unavailable
- `function:1870cb609ce1e2977308925c52cb776dae2b8d053edbcb16ebbb437c288d86b3:3835:4269|submit`; placement=placement:ab0805b49b25284a4b595837; conditions=!uniqueVariables.length:falsy

## client/src/components/Prompts/lists/ChatGroupItem.tsx (1)

### ChatGroupItem — prompts editor (1)

- route: unavailable
- `function:9018d911d1b7e61051f98411ba70f225b8e88b1f7534b6c3f70f7b15726914c9:2766:3160|click`; placement=placement:0ff7e2f0ab4870db08475f99; conditions=none

## client/src/components/Prompts/lists/NoPromptGroup.tsx (1)

### Button — prompts editor (1)

- route: unavailable
- `function:a35c9dc02c5bf265042ebfbe3ca443f5b10eb6090bab148b03907155bcff5419:665:722|click`; placement=placement:bf1bf295d648d44ef58576f3; conditions=!hasAccess:falsy; isNew && !hasCreateAccess:falsy; isNew:falsy; initialLoad:falsy; !canEdit && !permissionsLoading && groupsQuery?.data:truthy; !fetchedPrompt && !canView:truthy

## client/src/components/Sharing/PeoplePicker/PeoplePickerSearchItem.tsx (1)

### PeoplePickerSearchItem — share dialog (1)

- route: unavailable
- `function:ba07e362b000fac2c4a0e32472bcec740732567a332faadeee0966ea7e668db8:1908:1958|click`; placement=placement:3feb1f90bd5a44226e21c76c; conditions=none

## client/src/components/Sharing/PeoplePickerAdminSettings.tsx (1)

### LabelController — share dialog (1)

- route: unavailable
- `function:7731dcc03f64541eb35abe3f5fe59127dca393e906c5ccaa2ce1e9816d009997:1375:1487|click`; placement=placement:9a382d1a2f469dcd7d7b930f; conditions=none

## client/src/components/SidePanel/Agents/ActionsInput.tsx (2)

### Textarea — agent builder (1)

- route: unavailable
- `function:194e7d9b485302c4084865e0baea276c8be5fd71bc7882522296bafd42b7769f:5809:6115|change`; placement=placement:9305140f1b502f50a0a9de8b; conditions=none

### ActionsInput — agent builder (1)

- route: unavailable
- `function:194e7d9b485302c4084865e0baea276c8be5fd71bc7882522296bafd42b7769f:7004:7037|click`; placement=placement:f86baba8e92284a0d3092c47; conditions=none

## client/src/components/SidePanel/Agents/Advanced/AdvancedButton.tsx (1)

### AdvancedButton — agent builder (1)

- route: unavailable
- `function:53b3deddd27ed44b6534e6fbfff3c50a84197fef82f1425c4a8a2239f2f385ed:393:429|click`; placement=placement:113a7bfe2644d49b93075ae4; conditions=showButtons:truthy

## client/src/components/SidePanel/Agents/Advanced/AdvancedPanel.tsx (2)

### AdvancedPanel — agent builder (2)

- route: unavailable
- `function:8c190a4842fef8aed34fcfb2254737db0feba11d0c059343012a174406593fe1:1157:1525|click`; placement=placement:ff12c182e9eb9d3d0b4c9073; conditions=currentAgentId:truthy
- `function:8c190a4842fef8aed34fcfb2254737db0feba11d0c059343012a174406593fe1:1742:1777|click`; placement=placement:ff12c182e9eb9d3d0b4c9073; conditions=none

## client/src/components/SidePanel/Agents/AgentConfig.tsx (1)

### AgentConfig — agent builder (1)

- route: unavailable
- `function:03e1cb3bc038e969913a678f7dba70299865e9d83f2601d7e4a8a558aec974db:4516:4549|click`; placement=placement:c9991fd69ef7129112d7a196; conditions=none

## client/src/components/SidePanel/Agents/Code/Files.tsx (2)

### Files — files and previews (2)

- route: unavailable
- `function:70f3bf119eb143fb0565f14d2e004f4e44e2d4f0a810ce6837a8d5f9350895b0:1865:2043|change`; placement=placement:0a4078c1dfc3a9756dfc1648; conditions=isUploadDisabled:falsy
- `function:70f3bf119eb143fb0565f14d2e004f4e44e2d4f0a810ce6837a8d5f9350895b0:2122:2281|click`; placement=placement:0a4078c1dfc3a9756dfc1648; conditions=isUploadDisabled:falsy

## client/src/components/SidePanel/Agents/DuplicateAgent.tsx (1)

### Button — agent builder (1)

- route: unavailable
- `function:4699c1a67b067668b0b7ca39043fa389da6b19525aad89e31867d2e4dbe5e265:859:911|click`; placement=placement:38b8be81802d7ac088be4abc; conditions=(agent?.author === user?.id || user?.role === SystemRoles.ADMIN || canEditThisAgent) &&
          !permissionsLoading:truthy; isEphemeralAgent(agent_id):falsy

## client/src/components/SidePanel/Agents/FileContext.tsx (1)

### FileContext — files and previews (1)

- route: unavailable
- `function:5e07334db5176f1dbca05342dabc882b86221024582f8fdcf49e6fcec152be3e:3339:3498|click`; placement=placement:8868025aaad236032c6b487a; conditions=isUploadDisabled:falsy; sharePointEnabled:falsy

## client/src/components/SidePanel/Agents/FileSearch.tsx (2)

### FileSearch — files and previews (2)

- route: unavailable
- `function:6fe76399ecf32587c30a264889b0a43330d391da43f0d87777bb91b4e6cdb727:2995:3172|change`; placement=placement:01038c5dfff24edb0c3fcac9; conditions=isUploadDisabled:falsy
- `function:6fe76399ecf32587c30a264889b0a43330d391da43f0d87777bb91b4e6cdb727:3606:3765|click`; placement=placement:01038c5dfff24edb0c3fcac9; conditions=isUploadDisabled:falsy; sharePointEnabled:falsy

## client/src/components/SidePanel/Agents/Images.tsx (1)

### AvatarMenu — agent builder (1)

- route: unavailable
- `function:f58f7134821772a2cd06788f4a5cb224af3713a3c4aae46985401e899b0a8190:3292:3507|change`; placement=placement:2e255e8ea95ad32763f06339; conditions=none

## client/src/components/SidePanel/Agents/ImageVision.tsx (1)

### ImageVision — agent builder (1)

- route: unavailable
- `function:bc1731a2cd78ab546afc49907e73e4e6a9667a87795b25a58b00e9a09561eeca:1119:1255|click`; placement=placement:7273f60264e2fa811d18ff66; conditions=none

## client/src/components/SidePanel/Agents/Instructions.tsx (1)

### Instructions — agent builder (1)

- route: unavailable
- `function:5d6b8b95481aaafa07a9b2b53b823d0a62c6dcaf3d51ceefd302a8d0a14dd678:3560:3587|click`; placement=placement:342f7af09edc1cabdf66b5ab; conditions=none

## client/src/components/SidePanel/Agents/MCPIcon.tsx (2)

### MCPIcon — agent builder (2)

- route: unavailable
- `function:02e289adbd653e1c8f394d3148ee2a6d9f0d3b1e80648a1040c285bd1719c1f9:616:740|click`; placement=placement:9ac8b8022539dbfdb8a4645e; conditions=none
- `function:02e289adbd653e1c8f394d3148ee2a6d9f0d3b1e80648a1040c285bd1719c1f9:767:899|keydown`; placement=placement:94077f42cffa29ee2cbedec9; conditions=none

## client/src/components/SidePanel/Agents/MCPToolItem.tsx (1)

### MCPToolItem — agent builder (1)

- route: unavailable
- `function:f5f317d38b16c042b78a7edc2e70ef5305b04e33af841fdfc786a6b9c83faa21:4432:4468|click`; placement=placement:6c0f7936a3711c2bf19c89e7; conditions=none

## client/src/components/SidePanel/Agents/ModelPanel.tsx (2)

### ModelPanel — agent builder (2)

- route: unavailable
- `function:91de705a9d09aa413eb1e56614762f75457313382f64c8b189e698e83c063e35:3745:3912|click`; placement=placement:958e60d0f76c6a6ced04db00; conditions=none
- `function:91de705a9d09aa413eb1e56614762f75457313382f64c8b189e698e83c063e35:4129:4164|click`; placement=placement:958e60d0f76c6a6ced04db00; conditions=none

## client/src/components/SidePanel/Agents/Search/Action.tsx (1)

### Button — agent builder (1)

- route: unavailable
- `function:9e83325286d38646468d949e91e51a68f62aa47f96ea5307250012c832956b56:1462:1489|click`; placement=placement:585b51baa552de3ba3cae524; conditions=!isUserProvided:falsy; !isUserProvided:falsy

## client/src/components/SidePanel/Agents/Tools/ItemDialog/sections/McpSection.tsx (1)

### Button — agent builder (1)

- route: unavailable
- `function:dc46ba3bcd365111a7cee31a9a9c3feadffa373d4d6b6f3d75504270d110ec44:13861:14744|click`; placement=placement:6b99f4f938329327ef65f464; conditions=item.kind === 'builtin':falsy; item.kind === 'tool':falsy; item.kind === 'skill':falsy; item.kind === 'mcp':truthy

## client/src/components/SidePanel/Agents/Tools/ItemDialog/sections/ToolSection.tsx (1)

### ToolSection — agent builder (1)

- route: unavailable
- `function:946f1b049b213924606119075e015449075ebb4553692768237c36aa864c63cf:2995:3017|click`; placement=placement:4252c7c295afd299760c5d4c; conditions=item.kind === 'builtin':falsy; item.kind === 'tool':truthy; showConfigured:truthy

## client/src/components/SidePanel/Agents/Tools/MarketplaceSidebar.tsx (7)

### SidebarItem — marketplace details (7)

- route: unavailable
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:4379:4466|click`; placement=placement:fd3d924eadb3dbc14c5a137a; conditions=none
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:4718:4809|click`; placement=placement:6540f8c9533bbb7c5759e3a4; conditions=none
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:5055:5143|click`; placement=placement:ed236803575b3196f429c0fb; conditions=none
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:5383:5470|click`; placement=placement:e582d60c0caf59352b061266; conditions=none
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:5718:5808|click`; placement=placement:50cdbe99f52c161fb98c1208; conditions=none
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:6084:6164|click`; placement=placement:9c2fd8a722a426de96628595; conditions=none
- `function:48acd59ef76845eaa70d33844d5c277c8c2aaf4ae04f115444691787b5a66efa:6354:6439|click`; placement=placement:8ef989effcc8d87f4ae8240b; conditions=none

## client/src/components/SidePanel/Agents/Tools/ToolCard.tsx (3)

### ToolCardImpl — marketplace details (1)

- route: unavailable
- `function:0a328660c71874b1ddcab7094fa80257aea588bdb955981de2ecc05ee5c9cef2:3715:3735|click`; placement=placement:3f33217d20dc08b6757132a2; conditions=none

### ToolCardImpl — bookmarks panel (2)

- route: unavailable
- `function:0a328660c71874b1ddcab7094fa80257aea588bdb955981de2ecc05ee5c9cef2:7499:7597|click`; placement=placement:3f33217d20dc08b6757132a2; conditions=(canFavorite || canConfigure || showInfoOnly):truthy; (canConfigure || showInfoOnly):truthy
- `function:0a328660c71874b1ddcab7094fa80257aea588bdb955981de2ecc05ee5c9cef2:8382:8485|click`; placement=placement:3f33217d20dc08b6757132a2; conditions=(canFavorite || canConfigure || showInfoOnly):truthy; canFavorite:truthy

## client/src/components/SidePanel/Agents/Tools/ToolRow.tsx (2)

### ToolRowImpl — agent builder (2)

- route: unavailable
- `function:69593eee59eb3121751781918d69709dde5c310df6ca5601a734148f554de911:2894:2912|click`; placement=placement:3e70b6d8347311db3fda8f15; conditions=none
- `function:69593eee59eb3121751781918d69709dde5c310df6ca5601a734148f554de911:3494:3514|click`; placement=placement:3e70b6d8347311db3fda8f15; conditions=none

## client/src/components/SidePanel/Agents/Tools/ToolsSection.tsx (2)

### SelectedSection — agent builder (2)

- route: unavailable
- `function:ef5c3b4d89cf72e2211ba0d1098106322f0057453d783fe9335380cdcb9e3c16:10072:10097|click`; placement=placement:5ca87865b586bdea8b9fbf6b; conditions=showSkills:truthy
- `function:ef5c3b4d89cf72e2211ba0d1098106322f0057453d783fe9335380cdcb9e3c16:9671:9690|click`; placement=placement:e97bb6a70f2123f2fe495b6c; conditions=none

## client/src/components/SidePanel/Agents/Version/VersionButton.tsx (1)

### VersionButton — agent builder (1)

- route: unavailable
- `function:30d552e449ed9bbb207b37bd1b01113ffd663534cb04f01340e2f9f3cbecf088:351:386|click`; placement=placement:6bf84d6b60ff4895c6abc28c; conditions=showButtons:truthy; !!agent_id:truthy

## client/src/components/SidePanel/Agents/Version/VersionPanel.tsx (1)

### VersionPanel — agent builder (1)

- route: unavailable
- `function:83b99a334b05c40c77b4ddd8c32d639c380603fb4fe5c21fb5102d7a0a76bc9e:4501:4536|click`; placement=placement:048a8399a815015fa19db6c0; conditions=activePanel === Panel.version:truthy

## client/src/components/SidePanel/Bookmarks/BookmarkTable.tsx (2)

### Button — bookmarks panel (2)

- route: unavailable
- `function:5f44a8add82e5a561d6190d4ade936f81581c344d161a4a3f9e2dfb587ba86ba:3830:3881|click`; placement=placement:ccac6bfd5d64ab297007a0ac; conditions=filteredRows.length > pageSize:truthy
- `function:5f44a8add82e5a561d6190d4ade936f81581c344d161a4a3f9e2dfb587ba86ba:4289:4360|click`; placement=placement:e57185aee374f144c533b030; conditions=filteredRows.length > pageSize:truthy

## client/src/components/SidePanel/Builder/Action.tsx (1)

### Action — agent builder (1)

- route: unavailable
- `function:87fc59f13e88ab2ea9cfb4519aeecac4e34e1a9b7eea8a4f3bcc49bd51742782:417:514|keydown`; placement=placement:4fe80802518a44b5ac7ec1cd; conditions=none

## client/src/components/SidePanel/Builder/ActionCallback.tsx (1)

### Input — agent builder (1)

- route: unavailable
- `function:1ce445aa7350ef70097d0f66283559370c0419914540542d94f5a8dd3dd15894:1243:1282|focus`; placement=placement:08ab700539b591f78dad7f4d; conditions=!action_id || watch('type') !== AuthTypeEnum.OAuth:falsy; !action_id || watch('type') !== AuthTypeEnum.OAuth:falsy

## client/src/components/SidePanel/Builder/ActionsInput.tsx (1)

### ActionsInput — agent builder (1)

- route: unavailable
- `function:8f844a16b12bdee5ba69b5e8bfe9c9a034b1cb81722251ddbf5ec9edd36be5a1:5522:5771|change`; placement=placement:5e380aee6694b4a92bb8999b; conditions=none

## client/src/components/SidePanel/Builder/AssistantConversationStarters.tsx (2)

### AssistantConversationStarters — agent builder (2)

- route: unavailable
- `function:3a6bbea98b146d9943380fa42fa1d3d4ad275516641374b1f563faca56e0ba58:2611:2647|change`; placement=placement:0f8bd89c79003b027a1c6522; conditions=none
- `function:3a6bbea98b146d9943380fa42fa1d3d4ad275516641374b1f563faca56e0ba58:2672:2952|keydown`; placement=placement:0f8bd89c79003b027a1c6522; conditions=none

## client/src/components/SidePanel/Builder/CodeFiles.tsx (1)

### CodeFiles — files and previews (1)

- route: unavailable
- `function:959b9f2a3757570abea2a9493d77a443de77a399b2ba7d2e8e12b2e822c4a77f:1613:1772|click`; placement=placement:65bb30456b0ccd8cb3b5d6d7; conditions=codeEnabled && version:truthy; isUploadDisabled:falsy

## client/src/components/SidePanel/Builder/ImageVision.tsx (1)

### ImageVision — agent builder (1)

- route: unavailable
- `function:f7dd0eef580837abe34e7fa72883d49a2c453c7bc10b4ec878ca8af8d6299060:1132:1268|click`; placement=placement:7717ac003759ff48a07a509a; conditions=imageVisionEnabled && version == 1:truthy

## client/src/components/SidePanel/Builder/Knowledge.tsx (1)

### Knowledge — agent builder (1)

- route: unavailable
- `function:c3df6f50ce309c4f04ed9e37fe932b05432ea888f5aa6fd3201bb61463e42a87:1911:2070|click`; placement=placement:9c6ac5c186f85e031270f75a; conditions=isUploadDisabled:falsy

## client/src/components/SidePanel/Files/PanelTable.tsx (4)

### Button — files and previews (3)

- route: unavailable
- `function:741e29f66911249f519aa213222051aa44da31a8e2099d5a97a5e238ad7158a7:11223:11252|click`; placement=placement:e91daf4e71be3fdbfa8a90b1; conditions=none
- `function:741e29f66911249f519aa213222051aa44da31a8e2099d5a97a5e238ad7158a7:11723:11749|click`; placement=placement:9b54a5c7bea60193e5fbf621; conditions=none
- `function:741e29f66911249f519aa213222051aa44da31a8e2099d5a97a5e238ad7158a7:12143:12165|click`; placement=placement:77bb337dfe5b897861bd9907; conditions=none

### FilterInput — files and previews (1)

- route: unavailable
- `function:741e29f66911249f519aa213222051aa44da31a8e2099d5a97a5e238ad7158a7:6307:6381|change`; placement=placement:34a573c0c10ad18cf5bbf0e2; conditions=none

## client/src/components/SidePanel/MCPBuilder/MCPBuilderPanel.tsx (1)

### FilterInput — agent builder (1)

- route: unavailable
- `function:3925a452e0f677c8cd65827655ff460f4a8056e4e2e95db496a139398d5f1ddc:1984:2021|change`; placement=placement:48dbf20a3cb4e086fd0ef0c2; conditions=none

## client/src/components/SidePanel/MCPBuilder/MCPServerDialog/sections/BasicInfoSection.tsx (1)

### MCPIcon — agent builder (1)

- route: unavailable
- `function:ba75c638c7e66ce4a02def01df7ddd2c949be7e1577c39f17c53fc35a8bd284c:571:889|change`; placement=placement:9ac8b8022539dbfdb8a4645e; conditions=none

## client/src/components/SidePanel/Memories/MemoryPanel.tsx (4)

### FilterInput — other authenticated surface (1)

- route: unavailable
- `function:5d9ecbdfd094da400d7d322df144bb223a582e1b4d03baf299fd11f6b1895fa0:5798:5835|change`; placement=placement:7510b21841c473b94ed4247a; conditions=isLoading:falsy; !hasReadAccess:falsy

### Button — other authenticated surface (3)

- route: unavailable
- `function:5d9ecbdfd094da400d7d322df144bb223a582e1b4d03baf299fd11f6b1895fa0:7941:7990|click`; placement=placement:dd9414a782159872cad8d7aa; conditions=isLoading:falsy; !hasReadAccess:falsy; (memData?.tokenLimit != null || hasOptOutAccess):truthy; hasOptOutAccess:truthy
- `function:5d9ecbdfd094da400d7d322df144bb223a582e1b4d03baf299fd11f6b1895fa0:9402:9453|click`; placement=placement:8478044abaaeae8479036e03; conditions=isLoading:falsy; !hasReadAccess:falsy; (user?.role === SystemRoles.ADMIN || filteredMemories.length > pageSize):truthy; filteredMemories.length > pageSize:truthy
- `function:5d9ecbdfd094da400d7d322df144bb223a582e1b4d03baf299fd11f6b1895fa0:9909:9980|click`; placement=placement:ccda7362bd0b13209539ffc4; conditions=isLoading:falsy; !hasReadAccess:falsy; (user?.role === SystemRoles.ADMIN || filteredMemories.length > pageSize):truthy; filteredMemories.length > pageSize:truthy

## client/src/components/SidePanel/Parameters/Panel.tsx (2)

### Parameters — other authenticated surface (2)

- route: unavailable
- `function:477722d9a92fbc6b906797dedfda6206eacf8b7c78b91f1375ef1752957d7ca5:3936:4508|click`; placement=placement:0bd9c24f32680d80cc6a0643; conditions=!parameters:falsy
- `function:477722d9a92fbc6b906797dedfda6206eacf8b7c78b91f1375ef1752957d7ca5:4564:4719|click`; placement=placement:0bd9c24f32680d80cc6a0643; conditions=!parameters:falsy

## client/src/components/Skills/buttons/SkillToggle.tsx (1)

### SkillToggle — skills panel (1)

- route: unavailable
- `function:61e49a4d16b49b7c12c41e8e04a9bb5cd5b0bee3f0530b71ae7a7249226cd39b:369:434|click`; placement=placement:ec9f2ce10fd579fecbead246; conditions=none

## client/src/components/Skills/display/SkillDetail.tsx (2)

### ViewToggle — files and previews (2)

- route: unavailable
- `function:da6d80ad5079da4efb0979a73438467446dfd58a54153f07ffa2dba9df53462b:1153:1182|click`; placement=placement:5fbabf554d3890f4fd13e0e6; conditions=!rolesLoaded:falsy; !hasAccess:falsy; isCreate && !hasCreateAccess:falsy; isCreate:falsy; !skillId:falsy; isEdit:falsy; activeFile:falsy; skillQuery.isLoading:falsy; skillQuery.isError || !skillQuery.data:falsy
- `function:da6d80ad5079da4efb0979a73438467446dfd58a54153f07ffa2dba9df53462b:1677:1704|click`; placement=placement:5fbabf554d3890f4fd13e0e6; conditions=!rolesLoaded:falsy; !hasAccess:falsy; isCreate && !hasCreateAccess:falsy; isCreate:falsy; !skillId:falsy; isEdit:falsy; activeFile:falsy; skillQuery.isLoading:falsy; skillQuery.isError || !skillQuery.data:falsy

## client/src/components/Skills/display/SkillFileViewer.tsx (3)

### SkillFileViewer — files and previews (3)

- route: unavailable
- `function:ec6f0d52629a54caf75e4960ca39933a56e54527d947310a9617d68131dbe585:2719:2755|click`; placement=placement:f14aa37e2e4f9ed899c75dc7; conditions=none
- `function:ec6f0d52629a54caf75e4960ca39933a56e54527d947310a9617d68131dbe585:4324:4353|click`; placement=placement:f14aa37e2e4f9ed899c75dc7; conditions=isMarkdown && isText:truthy
- `function:ec6f0d52629a54caf75e4960ca39933a56e54527d947310a9617d68131dbe585:4892:4919|click`; placement=placement:f14aa37e2e4f9ed899c75dc7; conditions=isMarkdown && isText:truthy

## client/src/components/Skills/forms/SkillContentEditor.tsx (1)

### SkillContentEditor — skills panel (1)

- route: unavailable
- `function:76d3d784389e6c1c5adf59b4a493016d9dc3332bd0d16d3fa919112ae8f81db5:2955:2979|click`; placement=placement:99b9046de4e25ab2e59ff5d7; conditions=!isEditing:truthy

## client/src/components/Skills/layouts/SkillsView.tsx (1)

### SkillDetail — files and previews (1)

- route: unavailable
- `function:e83167520fa8b08587516c709fb239929e136f5e4cef165548219f75df848706:4233:4274|click`; placement=placement:694809facb41da350e7822cb; conditions=!rolesLoaded:falsy; !hasAccess:falsy; isCreate && !hasCreateAccess:falsy; isCreate:falsy; !skillId:falsy; isEdit:falsy; activeFile:falsy; skillQuery.isLoading:falsy; skillQuery.isError || !skillQuery.data:falsy; permissions.canEdit && onEdit:truthy

## client/src/components/Skills/lists/SkillList.tsx (1)

### SkillList — skills panel (1)

- route: unavailable
- `function:f8516f7a0f1b192a2a52cedf1a4eab75151841e4d5b71e04540eaf95d9567ca8:1381:1418|click`; placement=placement:7e94044e396326faef8018c0; conditions=isLoading:falsy

## client/src/components/Skills/lists/SkillListItem.tsx (4)

### FileTreeNode — files and previews (1)

- route: unavailable
- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:4286:4528|click`; placement=placement:858be23dc0e2ae986ad17a6a; conditions=none

### SkillListItem — skills panel (2)

- route: unavailable
- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:8227:8350|click`; placement=placement:5840d2a754a7974c9d673cce; conditions=none
- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:8956:9102|keydown`; placement=placement:5840d2a754a7974c9d673cce; conditions=none

### SkillListItem — files and previews (1)

- route: unavailable
- `function:972a96105dc6c487b9d7aca15087ee5bfe0164d95916a3bb2a23af327f728c07:8461:8553|click`; placement=placement:5840d2a754a7974c9d673cce; conditions=hasFiles:truthy

## client/src/components/Skills/sidebar/SkillsSidePanel.tsx (3)

### SkillsSidePanel — skills panel (3)

- route: unavailable
- `function:386529887fa39d8a9facde68342434eded01cfca2546e2cca039fe54819c17e2:1339:1399|click`; placement=placement:886eab04e6bafb9f132037c5; conditions=searchOpen:truthy
- `function:386529887fa39d8a9facde68342434eded01cfca2546e2cca039fe54819c17e2:1987:2023|change`; placement=placement:886eab04e6bafb9f132037c5; conditions=searchOpen:truthy
- `function:386529887fa39d8a9facde68342434eded01cfca2546e2cca039fe54819c17e2:3217:3242|click`; placement=placement:886eab04e6bafb9f132037c5; conditions=searchOpen:falsy

## client/src/components/Skills/tree/SkillFileEditor.tsx (3)

### SkillFileEditor — files and previews (2)

- route: unavailable
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1193:1365|change`; placement=placement:2fafa7b75c6c3ff7492bab01; conditions=isLoading:falsy
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1772:1920|keydown`; placement=placement:2fafa7b75c6c3ff7492bab01; conditions=isLoading:falsy

### Button — files and previews (1)

- route: unavailable
- `function:4f93da7f406e7f05ec4d74e2a234d628087945dff643e134fa1ec4d8e58cafa2:1427:1670|click`; placement=placement:64e7e92f91315da7a0bd8fdb; conditions=isLoading:falsy

## client/src/components/Tools/ToolItem.tsx (1)

### ToolItem — other authenticated surface (1)

- route: unavailable
- `function:d23f7f32553a39f9437c20be90db7d9981d49c61116478153bcfbfc21a95d5ec:460:554|click`; placement=placement:df321cc380341c5ae3f9b392; conditions=!isInstalled:truthy

## client/src/components/UnifiedSidebar/UnifiedSidebar.tsx (1)

### UnifiedSidebar — other authenticated surface (1)

- route: unavailable
- `function:37698d9b8cce400d0c26fcb80e77d4cf4c246b60fc1d663c2a9f25811631569d:2183:2256|click`; placement=placement:1106f7a9d4021af363b02b8e; conditions=isSmallScreen:truthy

## client/src/routes/RouteErrorBoundary.tsx (3)

### Button — other authenticated surface (3)

- route: unavailable
- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:2351:3240|click`; placement=placement:59ae2c648018e4617798686e; conditions=none
- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:3269:3422|click`; placement=placement:db18136c0f6aa05dc71dca74; conditions=errorDetails.stack != null && errorDetails.stack.trim() !== '':truthy
- `function:4fac7d010be784d964569ec6cc1d4c59621d975da839630a89cd8c028463444a:7754:7784|click`; placement=placement:8bb6ca538134516325eab88b; conditions=none

## client/src/utils/index.ts (1)

### MarkdownCode — chat message surface (1)

- route: unavailable
- `function:4258261b7fb1cfdb83c27dc4d4d03a62f8810d89cac3865b11e3fd0ad1538369:3981:4224|doubleclick`; placement=placement:3450f389f10b3ec970d34b2d; conditions=isMath:falsy; isMermaid:falsy; isSingleLine:truthy; lang === 'math':falsy; lang === 'mermaid':falsy; isSingleLineCode(children):truthy

## packages/client/src/components/Badge.tsx (3)

### Badge — other authenticated surface (3)

- route: unavailable
- `function:d0ac022ffaeeb57e7f82d56ed1f8e36a4d51d62cbc3bb31279bd955930380b64:1069:1288|click`; placement=placement:939cadcd04d374c63931ef5e; conditions=none
- `function:d0ac022ffaeeb57e7f82d56ed1f8e36a4d51d62cbc3bb31279bd955930380b64:3140:3166|mousedown`; placement=placement:939cadcd04d374c63931ef5e; conditions=isEditing && !isDragging:truthy
- `function:d0ac022ffaeeb57e7f82d56ed1f8e36a4d51d62cbc3bb31279bd955930380b64:3187:3271|click`; placement=placement:939cadcd04d374c63931ef5e; conditions=isEditing && !isDragging:truthy

## packages/client/src/components/DataTable.tsx (3)

### AnimatedSearchInput — other authenticated surface (1)

- route: unavailable
- `function:3fff0cce4fdac42df2ac2564fa1ef0cd23b3d7d180002260a99a38b34f07e14a:12847:12883|change`; placement=placement:2e023a447015870d13921335; conditions=filterColumn !== undefined && table.getColumn(filterColumn) && enableSearch:truthy

### SelectionCheckbox — other authenticated surface (2)

- route: unavailable
- `function:3fff0cce4fdac42df2ac2564fa1ef0cd23b3d7d180002260a99a38b34f07e14a:1290:1316|keydown`; placement=placement:bfaa3c79188f8f5794b14e04; conditions=none
- `function:3fff0cce4fdac42df2ac2564fa1ef0cd23b3d7d180002260a99a38b34f07e14a:1400:1426|click`; placement=placement:bfaa3c79188f8f5794b14e04; conditions=none

## packages/client/src/components/DataTable/DataTableComponents.tsx (2)

### SelectionCheckbox — other authenticated surface (2)

- route: unavailable
- `function:04c3b7a8cdbc5230f68ebb77843afeb5944a229c0302c982e5f6aa250fa56183:1120:1193|click`; placement=placement:7fb89a12ef739e2ad5085b48; conditions=none
- `function:04c3b7a8cdbc5230f68ebb77843afeb5944a229c0302c982e5f6aa250fa56183:876:1041|keydown`; placement=placement:7fb89a12ef739e2ad5085b48; conditions=none

## packages/client/src/components/DataTable/DataTableSearch.tsx (1)

### Input — other authenticated surface (1)

- route: unavailable
- `function:cc5bd4cc764e05f6e3767a28769ef5a56276dc4e975b5dbe6238f76424bd9a42:882:963|change`; placement=placement:b8fbcad05d56e973100fb895; conditions=shouldShowSearch:truthy

## packages/client/src/components/FormInput.tsx (1)

### Input — other authenticated surface (1)

- route: unavailable
- `function:936ae20d7e67f80adc98f3aca56e2f88509d3009cc63a4d81e85dd5fd3dce8e9:805:1104|change`; placement=placement:4c1ccce9dba1579afd63ae26; conditions=none

## packages/client/src/components/InputWithDropDown.tsx (3)

### Input — other authenticated surface (2)

- route: unavailable
- `function:59255ac636f4a2b0817ace265e7376ea015aabe39f47d2937cfb743942d99494:1198:1349|change`; placement=placement:e5e0dc9e76eac2d0416c43ed; conditions=none
- `function:59255ac636f4a2b0817ace265e7376ea015aabe39f47d2937cfb743942d99494:1378:2226|keydown`; placement=placement:e5e0dc9e76eac2d0416c43ed; conditions=none

### InputWithDropdown — other authenticated surface (1)

- route: unavailable
- `function:59255ac636f4a2b0817ace265e7376ea015aabe39f47d2937cfb743942d99494:3354:3378|click`; placement=placement:271996800ce1880086b71be2; conditions=none

## packages/client/src/components/MultiSearch.tsx (2)

### MultiSearch — other authenticated surface (2)

- route: unavailable
- `function:cf59288b5ae3a75b1389f5bb2f86137a646a07aaf4e511e0d78b54719950db0b:620:651|change`; placement=placement:6f2bd19c6e22c06cdf209318; conditions=none
- `function:cf59288b5ae3a75b1389f5bb2f86137a646a07aaf4e511e0d78b54719950db0b:697:793|click`; placement=placement:6f2bd19c6e22c06cdf209318; conditions=none

## packages/client/src/components/SecretInput.tsx (2)

### SecretInput — agent builder (1)

- route: unavailable
- `function:d8c88d65fb122c49ea8441ebc230719fc94b8d574579243b1c293638f8f0766f:1444:1494|click`; placement=placement:5f084141ce8fe79640d7cc68; conditions=shouldAutoRedirect:falsy; startupConfig?.emailLoginEnabled === true:truthy; !startupConfig:falsy; isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; secretInputVisible:truthy; resetPassword.isSuccess:falsy; secret:truthy; resetPassword.isSuccess:falsy

### SecretInput — other authenticated surface (1)

- route: unavailable
- `function:d8c88d65fb122c49ea8441ebc230719fc94b8d574579243b1c293638f8f0766f:1537:2015|click`; placement=placement:1d9042fbd046fdce45d211c6; conditions=secret:truthy; showCopy && copyButton == null:truthy; showCopy && copyButton == null:truthy; isConnectionLoading && connectionStatus == null:falsy; isConnectionError && connectionStatus == null:falsy; secretInputVisible:truthy; showCopy && copyButton == null:truthy; showCopy && copyButton == null:truthy; resetPassword.isSuccess:falsy; showCopy && copyButton == null:truthy; shouldAutoRedirect:falsy; startupConfig?.emailLoginEnabled === true:truthy; !startupConfig:falsy; showCopy && copyButton == null:truthy; showCopy && copyButton == null:truthy; showCopy && copyButton == null:truthy; resetPassword.isSuccess:falsy; showCopy && copyButton == null:truthy; showCopy && copyButton == null:truthy

## packages/client/src/components/Tag.tsx (1)

### TagPrimitiveRoot — other authenticated surface (1)

- route: unavailable
- `function:d19866ec29f6681eb79ac190f0f7d6b8bd7e1ab8c12e0f0ff7bc1fe443c748ba:1031:1121|click`; placement=placement:444ad97d28745a51f5669e8b; conditions=CancelButton:falsy; onRemove:truthy

## packages/client/src/components/ThemeSelector.tsx (2)

### Theme — other authenticated surface (2)

- route: unavailable
- `function:f607e3900a9d4f60b7811dba6cd08cc15e1c9973b71c9541599db447d14af3c3:1485:1558|click`; placement=placement:f1e3f366b3ac92d004009a45; conditions=returnThemeOnly === true:falsy; returnThemeOnly === true:truthy
- `function:f607e3900a9d4f60b7811dba6cd08cc15e1c9973b71c9541599db447d14af3c3:1577:1714|keydown`; placement=placement:f1e3f366b3ac92d004009a45; conditions=returnThemeOnly === true:falsy; returnThemeOnly === true:truthy

