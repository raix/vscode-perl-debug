How to help debug issues
========================

This document if for community members who wants to help debug and track down issues. Trying to support multiple OS's and versions of perl and perl5db is ambitious. Adding node and the vs code api to the calculation things just get harder to debug and workaround.

### Internal overview

Short overview of how the extension works:

#### The user adds the perl debugger for debugging

The extension provides a default configuration / settings

Details are in:
* [LaunchRequestArguments](src/perlDebug.ts)
* [initialConfigurations](src/extension.ts)
* [configurationAttributes](package.json)

#### The user running debugger

<!-- FIXME(bh): this is outdated -->

1. The extension starts up in a separate process from vscode, a `debug server`
2. The `debug server` will then spawn `perl5db` - somthing like `perl -d` *(unless overwritten by user settings)*

The current implementaion uses 3 streams for communicating with the spawned `perl5db` these are:
* `in` stream for writing commands
* `out` stream for reading output from `perl5db`
* `err` stream is used for getting the running program output

The extension basically just passes on any data from `err` stream to the `debug console` in vscode.

For talking with `perl5db` it's using the [streamCatcher](src/streamCatcher.ts) to queue the commands and link together the `command` and `perl5db` response. The `streamCatcher` is just a basic IO layer.

The [adapter](src/adapter.ts) is the abstraction layer handling `parsing` the `perl5db` response data. It's also providing the `perl5db` commands as a typescript api. So if some commands are not working correctly then this would be the first place to look.

The [perlDebug.ts](src/perlDebug.ts) is the layer wiring up the perl5db `adapter` to the vs code debugger api. This is where requests come in from the user / vs code and where we send a response that will populate inspector/watchers/breakpoints/exceptions or debug console view. *(the cool part)*

*There are some gotchas around how `filenames` and `paths` are handled in the different places - actually mostly between perl and node - and mostly around absolute/relative paths and system path separators.*

*Theres also some inconsistencies in how the vs code debug api handles variables/breakpoints vs watchers etc. making somethings hard to keep track of - things we might workaround later on*

#### Running extension.ts and perlDebug.ts in the same process

In `extension.ts` you can set `EMBED_DEBUG_ADAPTER` to `true` during
development. Visual Studio Code will then run the extension and any
instance of the debug adapter in the same process, so you can have
breakpoints in `extension.ts` and other parts of the code that work
during the same session. This option is not suitable for releases.

#### Test coverage

Theres added a test matrix making it possible to test in `macOS`/`linux` and `windows` - it's not perfect and not complete. First issue is to have a stable way of installing different distributions of perl *is not solved*.

The `streamCatcher` and `adapter` are both fairly well covered, but coverage of `perDebug` is in it's beginnings.


#### Running the tests

If you find an issue you can try running the tests locally, it's a great help to see if any fail.

For running the tests you'll need to install nodejs.
[install nodejs](https://nodejs.org/en/download/)

You can use both `npm` and `yarn` for installing the test depencencies.
`npm` comes bundles with nodejs, but also take a look at [yarn](https://yarnpkg.com/)

1. Install test depencies `npm install` or `yarn`
3. Run tests `npm test` or `yarn test`

* If any of the tests fails then theres a bug to fix
* If no tests fail theres a test to write to replicate

#### Running tests in watch mode

If you are developing and want the tests running while editing the source in `src/` then run:

1. `yarn test:w`

And live build and tests are up

#### Pull requests aka PR

If you found a bug and found a fix then don't be shy - do a pull request.
When tests are passing and code review is done it's ready to be released.

If you haven't then take a look at [github's "collaborating with issues and pull requests"](https://help.github.com/categories/collaborating-with-issues-and-pull-requests/) *you can tag issues in commits making it easier to track things*

Happy coding!
