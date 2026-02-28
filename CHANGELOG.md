# Changelog

## [1.3.0](https://github.com/reggi/skywriter/compare/skywriter-v1.2.1...skywriter-v1.3.0) (2026-02-28)


### Features

* add CSRF protection via SameSite cookie and Origin validation ([#35](https://github.com/reggi/skywriter/issues/35)) ([d0c5f02](https://github.com/reggi/skywriter/commit/d0c5f02523345d3ab82c797787668647b287fb4f))

## [1.2.1](https://github.com/reggi/skywriter/compare/skywriter-v1.2.0...skywriter-v1.2.1) (2026-02-26)


### Bug Fixes

* Docker deployment healthcheck and startup crashes ([#37](https://github.com/reggi/skywriter/issues/37)) ([6f9ba9e](https://github.com/reggi/skywriter/commit/6f9ba9e7d21e8fb083954e13b2d5c0ae11353242))

## [1.2.0](https://github.com/reggi/skywriter/compare/skywriter-v1.1.0...skywriter-v1.2.0) (2026-02-26)


### Features

* adds word wrap ([#29](https://github.com/reggi/skywriter/issues/29)) ([ec1d1f8](https://github.com/reggi/skywriter/commit/ec1d1f80404e64c8abf6ad26c351ca16a97ff469))


### Bug Fixes

* getPages loop ([#28](https://github.com/reggi/skywriter/issues/28)) ([9763674](https://github.com/reggi/skywriter/commit/97636740c11f1cd5f4af128dc923628848779bd7))
* pass array args to shell ([#31](https://github.com/reggi/skywriter/issues/31)) ([479dcba](https://github.com/reggi/skywriter/commit/479dcba535d86910a6bef3e91d7d70b9b2db1a75))
* upgrade npm and add verbose logging for OIDC publish ([56f52d9](https://github.com/reggi/skywriter/commit/56f52d985dd1ef13f51313fcf3c18f8e7421f168))

## [1.1.0](https://github.com/reggi/skywriter/compare/skywriter-v1.0.1...skywriter-v1.1.0) (2026-02-13)


### Features

* `excludeTemplates` by default from `fn.getPages` ([#8](https://github.com/reggi/skywriter/issues/8)) ([03c2daf](https://github.com/reggi/skywriter/commit/03c2dafd792dd51152e21081596f1afbc3410c4d))
* allows fn for serve to use fs discovery ([#5](https://github.com/reggi/skywriter/issues/5)) ([2cfff7f](https://github.com/reggi/skywriter/commit/2cfff7fd72cadae6971539cb21944d9379a9f786))
* changes the hompage for the server ([#10](https://github.com/reggi/skywriter/issues/10)) ([46b2572](https://github.com/reggi/skywriter/commit/46b2572bbb7535e13512e54e501c28300493913c))


### Bug Fixes

* adds favicon for docs ([#6](https://github.com/reggi/skywriter/issues/6)) ([293766f](https://github.com/reggi/skywriter/commit/293766fb93af35f4a3479162a7c791f12b7e75f1))
* cli version ([#21](https://github.com/reggi/skywriter/issues/21)) ([898ae0e](https://github.com/reggi/skywriter/commit/898ae0e43a12393eab48437c40a6bbabb74e01b1))
* esbuild issue, dist mkdir ([6da380c](https://github.com/reggi/skywriter/commit/6da380c9a57c08b397262cdd8a97fc49e68c021a))
* eta detection, allow md api if eta ([8491910](https://github.com/reggi/skywriter/commit/8491910f19e6e8549c699714c1f1874a87a77db1))
* eta detection, allow md api if eta ([e6b71ba](https://github.com/reggi/skywriter/commit/e6b71ba75dd9a02c96c5a9361fce6349149b2499))
* FileCredentialStore adds --auth-store ([#9](https://github.com/reggi/skywriter/issues/9)) ([10cbda8](https://github.com/reggi/skywriter/commit/10cbda8a0d1010b29d4b6b0a76dfaf6f83da6d6b))
* mobile logo overflow on small screens ([25383fc](https://github.com/reggi/skywriter/commit/25383fc87b2966ba7bc9c484c5009e49ff5b0f46))
* mobile tables, sidebar ([15b01ec](https://github.com/reggi/skywriter/commit/15b01ecf6d529ac55c876d692a35c7fc5686b1c8))
* render xml ([#7](https://github.com/reggi/skywriter/issues/7)) ([78afbca](https://github.com/reggi/skywriter/commit/78afbca2274b55b3e4add9f844db029bf3c8ae11))
* use PAT for release-please to trigger CI on PRs ([#22](https://github.com/reggi/skywriter/issues/22)) ([4795233](https://github.com/reggi/skywriter/commit/4795233df297d74b5cf6c9ac96c56267cdbddb9e))
