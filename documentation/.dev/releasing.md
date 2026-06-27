# everything there is to know about publishing your own release

## Build Process
1. **Trigger**: Any Git push to main branch
2. **Test Coverage**: Tests run automatically with code coverage reporting
3. **Platform Support**: Automatically builds for macOS (DMG), Linux (AppImage), and Windows (EXE)
4. **Artifact Management**: Uses GitHub Actions to upload platform-specific artifacts

## Release Process
1. **Tag Requirement**: Must use semantic versioning (`vX.Y.Z`)
2. **Automated Release**: Creates GitHub release with release notes
3. **Artifact Distribution**: Packages available in GitHub release assets

### tldr
1. go into package.json
2. update version numbers, e.g. 1.2.3
3. git commit -am v1.2.3
4. git tag v1.2.3
5. git push origin v1.2.3

> the "v-" before the version number is super important, otherwise the thingy won't run.


## to build app as standalone
> this is unrecommended, as it is likely we will implement Github actions to auto-build this. However, if it is necessary, here are instructions to manually build on your machine.

1. npm install
2. npm run build

> note that npm occassionally is unable to build packages on running npm install. it will typically say please run npm audit fix. this works most of the time. otherwise, try npm audit fix --force

> note that on windows, you need to enable developer settings. (settings -> system -> advanced -> developer mode)