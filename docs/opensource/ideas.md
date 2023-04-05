These are some of the projects I would like to work on, but haven't started yet.

# Shell Scripting Language Compiler

A simple imperative language intended to be used for shell scripting. However, it won't
have an interpret. Instead, it'll compile code to targets like Bash, Dockerfile, etc. The idea
is to have a simple and sane language for shell scripting without requiring users to install
an interpreter.

Features may include some basic support for parallelization, JSON [^1] and tabular data processing, etc.

[^1]: Parsing JSON in pure Bash sounds like fun, right? People [have done it](https://github.com/dominictarr/JSON.sh), though.
      Maybe it can be written in the language itself.

# Virtual Machine Shim for [`libcrun`](https://github.com/containers/crun)

Using containers on a development machine is fun if it is a Linux machine.
Otherwise, one has to resort to virtual machines. 

Lately, I've grown to appreciate having less dependencies that require separate installation. For that reason,
relying on docker, podman, runc, crun or other tools as binaries doesn't seem attractive anymore. I want to be able to
use `libcrun` on both Linux and macOS alike. With no change in API. Perhaps even use Virtualization Framework on macOS [^2].

[^2]: I know it doesn't have a great API and it has tons of deficiencies. But I think I may have a workaround or two.
