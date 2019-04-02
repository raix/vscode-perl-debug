# VS Code Perl Debug
[![Build Status](https://travis-ci.org/raix/vscode-perl-debug.svg?branch=master)](https://travis-ci.org/raix/vscode-perl-debug)
[![Build status](https://ci.appveyor.com/api/projects/status/rtt7e5fq99vw6857/branch/master)](https://ci.appveyor.com/project/raix/vscode-perl-debug/branch/master)
[![Greenkeeper](https://badges.greenkeeper.io/raix/vscode-perl-debug.svg)](https://greenkeeper.io/)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

A debugger for perl in vs code.

![Perl Debug](images/vscode-perl-debugger.gif)

### Features

* Breakpoints *(continue, step over, step in, step out)*
* Function breakpoints *(for now functions have to be loaded at launch)*
* Process control *(pause, resume, restart)*
* Stacktrace
* Variable inspection *(support for objects, arrays, strings, numbers and boolean)*
* Variable watching *(for now we don't create actual watch breakpoints - figuring out how to maintain t)*
* Setting new values of variables *(works inside of arrays and objects too)*
* Debug console for writing expressions *(write perl expressions in the debug console)*
* Variable values on hover in code
* Loaded modules view *(including source code retrieval from remote)*
* Multi-session/multi-target debugging *(including support for `fork` where available)*

### Settings

* `exec` Can be set to a specific perl binary *defaults to "perl"*
* `execArgs` Arguments that is passed to the binary perl executable
* `inc` Can be an array of strings / include paths
* `args` Can be an array of strings / program arguments
* `env` Used for setting environment variables when debugging, `PATH` and `PERL5LIB` default to system unless overwritten
* `trace` Boolean value to enable Debug Adapter Logging in `perl-debug.log` file
* `port` Number for port to listen for remote debuggers to connect to. *(Used only for remote debugging)*
* `console` String to identify where to launch the debuggee
* `debugRaw` Boolean to enable logging of raw I/O with the Perl debugger in an output channel
* `debugLog` Boolean to enable logging of other debug messages in an output channel
* `sessions` String to configure how child processes are handled

### Setup notes

You might have to install the `PadWalker` Perl package for variable inspection on Windows *(and some linux distributions?)*

A standard `launch.json` will resemble the following (on Windows, *nix distros will differ slightly.)

```json
    {
        "version": "0.2.0",
        "configurations": [
            {
                "type": "perl",
                "request": "launch",
                "console": "integratedTerminal",
                "exec": "C:/Perl64/bin/perl.exe",
                "execArgs": [],
                "name": "Perl Debug",
                "root": "${workspaceRoot}",
                "program": "${workspaceRoot}/${relativeFile}",
                "inc": [],
                "args": [],
                "stopOnEntry": true
            }
        ]
    }
```

### Remote debugger

When setting the `console` attribute in `launch.json` to `remote` the
vs code debug extension will start a debug server for the remote perl
debug instance to connect to.

eg.:
```bash
 # Start remote debugger in vs code on port 5000 then:
 $ PERLDB_OPTS="RemotePort=localhost:5000" perl -d test.pl
```
*`localhost` should be replaced by the ip address*

### Handling multiple processes

Visual Studio Code supports running multiple debugging sessions in
parallel, if you have multiple configurations in your `launch.json`,
you can start several of them simultaneously.

The extension can also automatically start additional debug sessions
when a Perl process `fork`s or if multiple debuggers try to connect
to the same `port`. This behaviour needs to be enabled with the
`sessions` option. To illustrate, with `launch.json` like

```json
...
  "sessions": "watch",
  "console": "remote",
  "port": 5000,
...
```

Then you can start a debug session in vscode and launch:

```bash
PERL5OPT=-d PERLDB_OPTS='RemotePort=localhost:5000' prove -l
```

All the Perl processes launched in one way or another by `prove` will
then connect to the extension. In `watch` mode execution of dependent
processes will continue immediately, in `break` mode they will stop
on entry (like with `stopOnEntry` for the first or main process).

When using this feature, it is recommended to use the debugger module
[Devel::vscode](https://metacpan.org/pod/Devel::vscode). It overrides
the `fork` function so that the Perl debugger connects to the
extension right after `fork` returns in the child. When the module is
not loaded, the extension creates a global watch expression `w $$` to
the same effect, but that puts the debugger in trace mode, wich can
slow down debugging considerably.

When you start the perl process you want to debug, instead of `-d`,
specify `-d:vscode`. If the extension starts the Perl process, set
`execArgs: ["-d:vscode"]` in `launch.json`.

### Stability

Tests matrix running between os and perl versions:

* OSX - perl 5.22
* OSX - perl 5.20
* OSX - perl 5.18
* OSX - perl 5.16
* OSX - perl 5.14
* Linux - perl 5.22
* Linux - perl 5.20
* Linux - perl 5.18
* Linux - perl 5.16
* Linux - perl 5.14
* Windows 64bit - Strawberry perl 5.24.1
* Windows 64bit - Strawberry perl 5.22.3
* Windows 64bit - Strawberry perl 5.20.3
* Windows 64bit - Strawberry perl 5.18.4
* Windows 64bit - Strawberry perl 5.16.3
* Windows 64bit - Activeperl 5.22.3.2204
* Windows 64bit - Activeperl 5.24.1.2402

Known issues on windows:

* "Restart" - `inhibit_exit` is not respected and will cause the debugger to stop
* Variable inspection unstable - it's due to output inconsistency from the perl debugger

If you want to help test / debug read [DEBUGGING.md](DEBUGGING.md)

### Todo

* Watching variables doesn't create actual expression watchers yet - need more api for actually maintaining the list of expressions to watch. I might be able to do a workaround for now.
* Variable values on hover doesn't work all the time due to the lack of info, eg. `$obj->{ownObj}->{ownFoo}` hovering over `$obj` will work fine - but the children are not parsed correctly - to solve this we might need to parse the line of code.

### Problems with `perl5db.pl` affecting this extension

* [#133875: warnLevel=0 is not the default](https://rt.perl.org/Ticket/Display.html?id=133875)
* [#130361: debugger does not stop at postponed breakpoints](https://rt.perl.org/Ticket/Display.html?id=130361)

### Credits

Credits goes to Microsoft for making an awesome editor and a nice getting started mock debugger: [https://github.com/Microsoft/vscode-mock-debug.git](https://github.com/Microsoft/vscode-mock-debug.git)


### Reporting issues and feature requests

I don't care about stars, but for everybodys sake:
Please use github for tracking issues and feature requests, thanks!

When you report an issue, it can be very helpful to enable `debugRaw`
in your launch configuration. When enabled, you should have an output
channel named `Perl Debug RAW` with contents like:

```json
["2019-03-02T21:49:50.230Z","perl-debug.streamcatcher.write","127.0.0.1:40133 serving 127.0.0.1:43320","p $]\n"]
["2019-03-02T21:49:50.231Z","perl-debug.streamcatcher.data","127.0.0.1:40133 serving 127.0.0.1:43320","5.028001"]
...
```

These are the raw commands sent to the `perl5db.pl` debugger and the
responses received. Including these in your report can make it easier
to track down version differences and portability problems.

I do take pull requests for both documentation and code improvements!

Please be aware that this plugin depends on the OS/vs code/perl distribution/perl5db.pl
and none of these are perfect/consistent dependencies, therefor hard to track down.
*Why I've added a fairly broad test matrix across os/perl distributions*

Please keep in mind that I'm an ES developer, I don't know all
the corners of perl - so any help is appriciated.

This project is using `semantic release` and `commitlint` for vs code extensions.
*Commit messages should be formatted accordingly and should trigger correct*
*versioning and automatic release / publish in the extension gallary.*

Kind regards

Morten
