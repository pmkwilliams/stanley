<!-- https://github.com/BurntSushi/ripgrep · 2026-10-15 · GitHub - BurntSushi/ripgrep: ripgrep recursively searches directories for a regex pattern while respecting your gitignore · GitHub -->
- BurntSushi
- ripgrep
## Repository navigation
- Code
- Issues 126 (126)
- Pull requests 81 (81)
- Discussions
- Actions
- Security and quality
- Insights
ripgrep
Public
- Sponsor
- Notifications
- Fork5.5k (5.5k)
- Star69.1k (69.1k)
[master branch: collapsed]
16 Branches 272 Tags
[Go to file: empty]
[Code: collapsed]
## Latest commit
BurntSushi BurntSushi
ignore-0.4.33
[success]
3fce3b5 · Aug 4, 2026
## History
2,287 Commits
## Folders and files
Name: .cargo; Last commit message: cargo: explicitly configure musl to be statically linked; Last commit date: Nov 21, 2023
Name: .github; Last commit message: ci: attest build provenance for release archives; Last commit date: Jul 28, 2026
Name: benchsuite; Last commit message: benchsuite/runs: add another run of the benchmarks; Last commit date: Dec 16, 2022
Name: ci; Last commit message: test-complete: misc. improvements; Last commit date: Jul 8, 2026
Name: crates; Last commit message: ignore-0.4.33; Last commit date: Aug 4, 2026
Name: fuzz; Last commit message: rust: move to Rust 2024; Last commit date: Sep 20, 2025
Name: pkg; Last commit message: pkg/brew: update tap; Last commit date: Jul 15, 2026
Name: scripts; Last commit message: scripts: add copy-examples; Last commit date: Sep 7, 2018
Name: tests; Last commit message: ci: fix binary discovery; Last commit date: Aug 3, 2026
Name: .gitignore; Last commit message: index: add some initial indexing scaffolding; Last commit date: Jul 22, 2026
Name: .ignore; Last commit message: ripgrep: add /.github/ to whitelist; Last commit date: Aug 17, 2022
Name: .nvim.lua; Last commit message: nvim: enable all Cargo features; Last commit date: Jul 22, 2026
Name: AI_POLICY.md; Last commit message: docs: s/our projects/this project in AI policy; Last commit date: May 26, 2026
Name: CHANGELOG.md; Last commit message: changelog: start next section; Last commit date: Jul 15, 2026
Name: CONTRIBUTING.md; Last commit message: doc: update AI policy link to point to ripgrep's document; Last commit date: Jul 8, 2026
Name: COPYING; Last commit message: initial commit; Last commit date: Feb 27, 2016
Name: Cargo.lock; Last commit message: ignore-0.4.33; Last commit date: Aug 4, 2026
Name: Cargo.toml; Last commit message: index: add some initial indexing scaffolding; Last commit date: Jul 22, 2026
Name: FAQ.md; Last commit message: colors: add highlight type support for matching lines; Last commit date: Sep 20, 2025
Name: GUIDE.md; Last commit message: docs: update GUIDE to use lexopt; Last commit date: Jun 3, 2026
Name: HomebrewFormula; Last commit message: Make the repo a Homebrew Tap; Last commit date: Sep 30, 2016
Name: LICENSE-MIT; Last commit message: initial commit; Last commit date: Feb 27, 2016
Name: README.md; Last commit message: msrv: bump to Rust 1.96; Last commit date: Jul 17, 2026
Name: RELEASE-CHECKLIST.md; Last commit message: doc: move CHANGELOG update before dependency updates; Last commit date: Oct 16, 2025
Name: UNLICENSE; Last commit message: initial commit; Last commit date: Feb 27, 2016
Name: build.rs; Last commit message: build: emit warning if git is missing during build; Last commit date: Sep 20, 2025
Name: rustfmt.toml; Last commit message: style: apply rustfmt; Last commit date: Sep 20, 2025
## Repository files navigation
- README
- Contributing
- Unlicense license
- License
- MIT license
[Outline: collapsed]
## ripgrep (rg)
Permalink: ripgrep (rg)
ripgrep is a line-oriented search tool that recursively searches the current directory for a regex pattern. By default, ripgrep will respect gitignore rules and automatically skip hidden files/directories and binary files. (To disable all automatic filtering by default, use rg -uuu .) ripgrep has first class support on Windows, macOS and Linux, with binary downloads available for every release . ripgrep is similar to other popular search tools like The Silver Searcher, ack and grep.
Build status Crates.io Packaging status
Dual-licensed under MIT or the UNLICENSE .
### CHANGELOG
Permalink: CHANGELOG
Please see the CHANGELOG for a release history.
### Documentation quick links
Permalink: Documentation quick links
- Installation
- User Guide
- Frequently Asked Questions
- Regex syntax
- Configuration files
- Shell completions
- Building
- Translations
### Screenshot of search results
Permalink: Screenshot of search results
A screenshot of a sample search with ripgrep
### Quick examples comparing tools
Permalink: Quick examples comparing tools
This example searches the entire Linux kernel source tree (after running make defconfig && make -j8 ) for [A-Z]+_SUSPEND , where all matches must be words. Timings were collected on a system with an Intel i9-12900K 5.2 GHz.
Please remember that a single benchmark is never enough! See my blog post on ripgrep for a very detailed comparison with more benchmarks and analysis.
Tool Command Line count Time
Tool: ripgrep (Unicode); Command: rg -n -w '[A-Z]+_SUSPEND'; Line count: 536; Time: 0.082s (1.00x)
Tool: hypergrep; Command: hgrep -n -w '[A-Z]+_SUSPEND'; Line count: 536; Time: 0.167s (2.04x)
Tool: git grep; Command: git grep -P -n -w '[A-Z]+_SUSPEND'; Line count: 536; Time: 0.273s (3.34x)
Tool: The Silver Searcher; Command: ag -w '[A-Z]+_SUSPEND'; Line count: 534; Time: 0.443s (5.43x)
Tool: ugrep; Command: ugrep -r --ignore-files --no-hidden -I -w '[A-Z]+_SUSPEND'; Line count: 536; Time: 0.639s (7.82x)
Tool: git grep; Command: LC_ALL=C git grep -E -n -w '[A-Z]+_SUSPEND'; Line count: 536; Time: 0.727s (8.91x)
Tool: git grep (Unicode); Command: LC_ALL=en_US.UTF-8 git grep -E -n -w '[A-Z]+_SUSPEND'; Line count: 536; Time: 2.670s (32.70x)
Tool: ack; Command: ack -w '[A-Z]+_SUSPEND'; Line count: 2677; Time: 2.935s (35.94x)
Here's another benchmark on the same corpus as above that disregards gitignore files and searches with a whitelist instead. The corpus is the same as in the previous benchmark, and the flags passed to each command ensure that they are doing equivalent work:
Tool Command Line count Time
Tool: ripgrep; Command: rg -uuu -tc -n -w '[A-Z]+_SUSPEND'; Line count: 447; Time: 0.063s (1.00x)
Tool: ugrep; Command: ugrep -r -n --include='*.c' --include='*.h' -w '[A-Z]+_SUSPEND'; Line count: 447; Time: 0.607s (9.62x)
Tool: GNU grep; Command: grep -E -r -n --include='*.c' --include='*.h' -w '[A-Z]+_SUSPEND'; Line count: 447; Time: 0.674s (10.69x)
Now we'll move to searching on single large file. Here is a straight-up comparison between ripgrep, ugrep and GNU grep on a file cached in memory (~13GB, OpenSubtitles.raw.en.gz , decompressed):
Tool Command Line count Time
Tool: ripgrep (Unicode); Command: rg -w 'Sherlock [A-Z]\w+'; Line count: 7882; Time: 1.042s (1.00x)
Tool: ugrep; Command: ugrep -w 'Sherlock [A-Z]\w+'; Line count: 7882; Time: 1.339s (1.28x)
Tool: GNU grep (Unicode); Command: LC_ALL=en_US.UTF-8 egrep -w 'Sherlock [A-Z]\w+'; Line count: 7882; Time: 6.577s (6.31x)
In the above benchmark, passing the -n flag (for showing line numbers) increases the times to 1.664s for ripgrep and 9.484s for GNU grep. ugrep times are unaffected by the presence or absence of -n .
Beware of performance cliffs though:
Tool Command Line count Time
Tool: ripgrep (Unicode); Command: rg -w '[A-Z]\w+ Sherlock [A-Z]\w+'; Line count: 485; Time: 1.053s (1.00x)
Tool: GNU grep (Unicode); Command: LC_ALL=en_US.UTF-8 grep -E -w '[A-Z]\w+ Sherlock [A-Z]\w+'; Line count: 485; Time: 6.234s (5.92x)
Tool: ugrep; Command: ugrep -w '[A-Z]\w+ Sherlock [A-Z]\w+'; Line count: 485; Time: 28.973s (27.51x)
And performance can drop precipitously across the board when searching big files for patterns without any opportunities for literal optimizations:
Tool Command Line count Time
Tool: ripgrep; Command: rg '[A-Za-z]{30}'; Line count: 6749; Time: 15.569s (1.00x)
Tool: ugrep; Command: ugrep -E '[A-Za-z]{30}'; Line count: 6749; Time: 21.857s (1.40x)
Tool: GNU grep; Command: LC_ALL=C grep -E '[A-Za-z]{30}'; Line count: 6749; Time: 32.409s (2.08x)
Tool: GNU grep (Unicode); Command: LC_ALL=en_US.UTF-8 grep -E '[A-Za-z]{30}'; Line count: 6795; Time: 8m30s (32.74x)
Finally, high match counts also tend to both tank performance and smooth out the differences between tools (because performance is dominated by how quickly one can handle a match and not the algorithm used to detect the match, generally speaking):
Tool Command Line count Time
Tool: ripgrep; Command: rg the; Line count: 83499915; Time: 6.948s (1.00x)
Tool: ugrep; Command: ugrep the; Line count: 83499915; Time: 11.721s (1.69x)
Tool: GNU grep; Command: LC_ALL=C grep the; Line count: 83499915; Time: 15.217s (2.19x)
### Why should I use ripgrep?
Permalink: Why should I use ripgrep?
- It can replace many use cases served by other search tools because it contains most of their features and is generally faster. (See the FAQ for more details on whether ripgrep can truly replace grep.)
- Like other tools specialized to code search, ripgrep defaults to recursive search and does automatic filtering . Namely, ripgrep won't search files ignored by your .gitignore / .ignore / .rgignore files, it won't search hidden files and it won't search binary files. Automatic filtering can be disabled with rg -uuu .
- ripgrep can search specific types of files . For example, rg -tpy foo limits your search to Python files and rg -Tjs foo excludes JavaScript files from your search. ripgrep can be taught about new file types with custom matching rules.
- ripgrep supports many features found in grep , such as showing the context of search results, searching multiple patterns, highlighting matches with color and full Unicode support. Unlike GNU grep, ripgrep stays fast while supporting Unicode (which is always on).
- ripgrep has optional support for switching its regex engine to use PCRE2. Among other things, this makes it possible to use look-around and backreferences in your patterns, which are not supported in ripgrep's default regex engine. PCRE2 support can be enabled with -P/--pcre2 (use PCRE2 always) or --auto-hybrid-regex (use PCRE2 only if needed). An alternative syntax is provided via the --engine (default|pcre2|auto) option.
- ripgrep has rudimentary support for replacements , which permit rewriting output based on what was matched.
- ripgrep supports searching files in text encodings other than UTF-8, such as UTF-16, latin-1, GBK, EUC-JP, Shift_JIS and more. (Some support for automatically detecting UTF-16 is provided. Other text encodings must be specifically specified with the -E/--encoding flag.)
- ripgrep supports searching files compressed in a common format (brotli, bzip2, gzip, lz4, lzma, xz, or zstandard) with the -z/--search-zip flag.
- ripgrep supports arbitrary input preprocessing filters which could be PDF text extraction, less supported decompression, decrypting, automatic encoding detection and so on.
- ripgrep can be configured via a configuration file .
In other words, use ripgrep if you like speed, filtering by default, fewer bugs and Unicode support.
### Why shouldn't I use ripgrep?
Permalink: Why shouldn't I use ripgrep?
Despite initially not wanting to add every feature under the sun to ripgrep, over time, ripgrep has grown support for most features found in other file searching tools. This includes searching for results spanning across multiple lines, and opt-in support for PCRE2, which provides look-around and backreference support.
At this point, the primary reasons not to use ripgrep probably consist of one or more of the following:
- You need a portable and ubiquitous tool. While ripgrep works on Windows, macOS and Linux, it is not ubiquitous and it does not conform to any standard such as POSIX. The best tool for this job is good old grep.
- There still exists some other feature (or bug) not listed in this README that you rely on that's in another tool that isn't in ripgrep.
- There is a performance edge case where ripgrep doesn't do well where another tool does do well. (Please file a bug report!)
- ripgrep isn't possible to install on your machine or isn't available for your platform. (Please file a bug report!)
### Is it really faster than everything else?
Permalink: Is it really faster than everything else?
Generally, yes. A large number of benchmarks with detailed analysis for each is available on my blog .
Summarizing, ripgrep is fast because:
- It is built on top of Rust's regex engine . Rust's regex engine uses finite automata, SIMD and aggressive literal optimizations to make searching very fast. (PCRE2 support can be opted into with the -P/--pcre2 flag.)
- Rust's regex library maintains performance with full Unicode support by building UTF-8 decoding directly into its deterministic finite automaton engine.
- It supports searching with either memory maps or by searching incrementally with an intermediate buffer. The former is better for single files and the latter is better for large directories. ripgrep chooses the best searching strategy for you automatically.
- Applies your ignore patterns in .gitignore files using a RegexSet . That means a single file path can be matched against multiple glob patterns simultaneously.
- It uses a lock-free parallel recursive directory iterator, courtesy of crossbeam and ignore .
### Feature comparison
Permalink: Feature comparison
Andy Lester, author of ack , has published an excellent table comparing the features of ack, ag, git-grep, GNU grep and ripgrep: https://beyondgrep.com/feature-comparison/
Note that ripgrep has grown a few significant new features recently that are not yet present in Andy's table. This includes, but is not limited to, configuration files, passthru, support for searching compressed files, multiline search and opt-in fancy regex support via PCRE2.
### Playground
Permalink: Playground
If you'd like to try ripgrep before installing, there's an unofficial playground and an interactive tutorial .
If you have any questions about these, please open an issue in the tutorial repo .
### Installation
Permalink: Installation
The binary name for ripgrep is rg .
Archives of precompiled binaries for ripgrep are available for Windows, macOS and Linux. Linux and Windows binaries are static executables. Users of platforms not explicitly mentioned below are advised to download one of these archives.
If you're a macOS Homebrew or a Linuxbrew user, then you can install ripgrep from homebrew-core:
$ brew install ripgrep
[Copy code to clipboard]
If you're a MacPorts user, then you can install ripgrep from the official ports :
$ sudo port install ripgrep
[Copy code to clipboard]
If you're a Windows Chocolatey user, then you can install ripgrep from the official repo :
$ choco install ripgrep
[Copy code to clipboard]
If you're a Windows Scoop user, then you can install ripgrep from the official bucket :
$ scoop install ripgrep
[Copy code to clipboard]
If you're a Windows Winget user, then you can install ripgrep from the winget-pkgs repository:
$ winget install BurntSushi.ripgrep.MSVC
[Copy code to clipboard]
If you're an Arch Linux user, then you can install ripgrep from the official repos:
$ sudo pacman -S ripgrep
[Copy code to clipboard]
If you're a Gentoo user, you can install ripgrep from the official repo :
$ sudo emerge sys-apps/ripgrep
[Copy code to clipboard]
If you're a Fedora user, you can install ripgrep from official repositories.
$ sudo dnf install ripgrep
[Copy code to clipboard]
If you're an openSUSE user, ripgrep is included in openSUSE Tumbleweed and openSUSE Leap since 15.1.
$ sudo zypper install ripgrep
[Copy code to clipboard]
If you're a CentOS Stream 10 user, you can install ripgrep from the EPEL repository:
$ sudo dnf config-manager --set-enabled crb $ sudo dnf install https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm $ sudo dnf install ripgrep
[Copy code to clipboard]
If you're a Red Hat 10 user, you can install ripgrep from the EPEL repository:
$ sudo subscription-manager repos --enable codeready-builder-for-rhel-10-$(arch)-rpms $ sudo dnf install https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm $ sudo dnf install ripgrep
[Copy code to clipboard]
If you're a Rocky Linux 10 user, you can install ripgrep from the EPEL repository:
$ sudo dnf install https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm $ sudo dnf install ripgrep
[Copy code to clipboard]
If you're a Nix user, you can install ripgrep from nixpkgs :
$ nix-env --install ripgrep
[Copy code to clipboard]
If you're a Flox user, you can install ripgrep as follows:
$ flox install ripgrep
[Copy code to clipboard]
If you're a Guix user, you can install ripgrep from the official package collection:
$ guix install ripgrep
[Copy code to clipboard]
If you're a Debian user (or a user of a Debian derivative like Ubuntu ), then ripgrep can be installed using a binary .deb file provided in each ripgrep release .
$ curl -LO https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep_14.1.1-1_amd64.deb $ sudo dpkg -i ripgrep_14.1.1-1_amd64.deb
[Copy code to clipboard]
If you run Debian stable, ripgrep is officially maintained by Debian , although its version may be older than the deb package available in the previous step.
$ sudo apt-get install ripgrep
[Copy code to clipboard]
If you're an Ubuntu Cosmic (18.10) (or newer) user, ripgrep is available using the same packaging as Debian:
$ sudo apt-get install ripgrep
[Copy code to clipboard]
(N.B. Various snaps for ripgrep on Ubuntu are also available, but none of them seem to work right and generate a number of very strange bug reports that I don't know how to fix and don't have the time to fix. Therefore, it is no longer a recommended installation option.)
If you're an ALT user, you can install ripgrep from the official repo :
$ sudo apt-get install ripgrep
[Copy code to clipboard]
If you're a FreeBSD user, then you can install ripgrep from the official ports :
$ sudo pkg install ripgrep
[Copy code to clipboard]
If you're an OpenBSD user, then you can install ripgrep from the official ports :
$ doas pkg_add ripgrep
[Copy code to clipboard]
If you're a NetBSD user, then you can install ripgrep from pkgsrc :
$ sudo pkgin install ripgrep
[Copy code to clipboard]
If you're a Haiku x86_64 user, then you can install ripgrep from the official ports :
$ sudo pkgman install ripgrep
[Copy code to clipboard]
If you're a Haiku x86_gcc2 user, then you can install ripgrep from the same port as Haiku x86_64 using the x86 secondary architecture build:
$ sudo pkgman install ripgrep_x86
[Copy code to clipboard]
If you're a Void Linux user, then you can install ripgrep from the official repository :
$ sudo xbps-install -Syv ripgrep
[Copy code to clipboard]
If you're a Rust programmer , ripgrep can be installed with cargo .
- Note that the minimum supported version of Rust for ripgrep is 1.96.0 , although ripgrep may work with older versions.
- Note that the binary may be bigger than expected because it contains debug symbols. This is intentional. To remove debug symbols and therefore reduce the file size, run strip on the binary.
$ cargo install ripgrep
[Copy code to clipboard]
Alternatively, one can use cargo binstall to install a ripgrep binary directly from GitHub:
$ cargo binstall ripgrep
[Copy code to clipboard]
### Building
Permalink: Building
ripgrep is written in Rust, so you'll need to grab a Rust installation in order to compile it. ripgrep compiles with Rust 1.96.0 (stable) or newer. In general, ripgrep tracks the latest stable release of the Rust compiler.
To build ripgrep:
$ git clone https://github.com/BurntSushi/ripgrep $ cd ripgrep $ cargo build --release $ ./target/release/rg --version 0.1.3
[Copy code to clipboard]
NOTE: In the past, ripgrep supported a simd-accel Cargo feature when using a Rust nightly compiler. This only benefited UTF-16 transcoding. Since it required unstable features, this build mode was prone to breakage. Because of that, support for it has been removed. If you want SIMD optimizations for UTF-16 transcoding, then you'll have to petition the encoding_rs project to use stable APIs.
Finally, optional PCRE2 support can be built with ripgrep by enabling the pcre2 feature:
$ cargo build --release --features 'pcre2'
[Copy code to clipboard]
Enabling the PCRE2 feature works with a stable Rust compiler and will attempt to automatically find and link with your system's PCRE2 library via pkg-config . If one doesn't exist, then ripgrep will build PCRE2 from source using your system's C compiler and then statically link it into the final executable. Static linking can be forced even when there is an available PCRE2 system library by either building ripgrep with the MUSL target or by setting PCRE2_SYS_STATIC=1 .
ripgrep can be built with the MUSL target on Linux by first installing the MUSL library on your system (consult your friendly neighborhood package manager). Then you just need to add MUSL support to your Rust toolchain and rebuild ripgrep, which yields a fully static executable:
$ rustup target add x86_64-unknown-linux-musl $ cargo build --release --target x86_64-unknown-linux-musl
[Copy code to clipboard]
Applying the --features flag from above works as expected. If you want to build a static executable with MUSL and with PCRE2, then you will need to have musl-gcc installed, which might be in a separate package from the actual MUSL library, depending on your Linux distribution.
### Running tests
Permalink: Running tests
ripgrep is relatively well-tested, including both unit tests and integration tests. To run the full test suite, use:
$ cargo test --all
[Copy code to clipboard]
from the repository root.
### Related tools
Permalink: Related tools
- delta is a syntax highlighting pager that supports the rg --json output format. So all you need to do to make it work is rg --json pattern | delta . See delta's manual section on grep for more details.
### Vulnerability reporting
Permalink: Vulnerability reporting
For reporting a security vulnerability, please contact Andrew Gallant . The contact page has my email address and PGP public key if you wish to send an encrypted message.
### Translations
Permalink: Translations
The following is a list of known translations of ripgrep's documentation. These are unofficially maintained and may not be up to date.
- Chinese
- Spanish
## About
ripgrep recursively searches directories for a regex pattern while respecting your gitignore
### Topics
cli command-line command-line-tool gitignore grep recursively-search regex ripgrep rust search
### Resources
Readme
[Unlicense and 2 other licenses found: collapsed]
### Contributing
Contributing
Activity
### Stars
69.1k stars
### Watchers
318 watching
### Forks
5.5k forks
Report repository
## Releases ( 75 )
15.2.0 Latest
+ 74 releases
## Sponsor this project
- @BurntSushi BurntSushi Andrew Gallant Sponsor @BurntSushi
Learn more about GitHub Sponsors
## Used by ( 1.4K )
+ 1,376
## Contributors ( 447 )
- @BurntSushi
- @okdana
- @jgarte
- @balajisivaraman
- @igor-raits
- @tiehuis
- @lyuha
- @ericbn
- @theamazingfedex
- @atouchet
- @lilianmoraru
- @tmccombs
- @ltrzesniewski
- @LingMan
+ 433 contributors
## Languages
- Rust 95%
- Python 2.4%
- Shell 1.9%
- Other 0.7%
