These are some of the projects I would like to work on, but haven't started yet.

# Postgres-related

## In-memory access method

For cases like long-term in-memory caches, it'd be great to not have them
stored on disk at all (_that rules out unlogged tables_) and have them
persisted across sessions (_that rules out temporary tables_).

I am eyeing the idea of implementing a table/index access method that will work
in shared memory.

??? abstract "Notes"

    I think that in order to make it easier to deploy, it should not use Postgres shared memory
    and instead work with operating system's shared memory directly. 


# Postgres Patches

## Enable overriding hard-coded paths in `postgresql.conf`

The fact that many paths are hard-coded in postgres during compile-time can be frustrating
at times. No way to change that without recompiling it. It'd be great if `postgres` and `pg_config`
were able to do this. 

??? question "How can this be implemented?"

    There's `src/port/pg_config_paths.h` generated when configuring Postgres that hard-codes all these
    paths.

    What I've done so far is augmenting it with something like:

    ```c
    const char * _PGSHAREDIR = PGSHAREDIR;
    #undef PGSHAREDIR
    #define PGSHAREDIR ((const char *)getenv("PGSHAREDIR") ? : _PGSHAREDIR)
    ```

    Now, of course, this `getenv` call would have to be changed to attempt retrieving the string from
    the configuration setting.

    Also, `pg_config` would need to be able to take an option to point to
    `postgresql.conf`.


# Shell Scripting Language Compiler

A simple imperative language intended to be used for shell scripting. However, it won't
have an interpret. Instead, it'll compile code to targets like Bash, Dockerfile, etc. The idea
is to have a simple and sane language for shell scripting without requiring users to install
an interpreter.

Features may include some basic support for parallelization, JSON [^json] and tabular data processing, etc.

[^json]: Parsing JSON in pure Bash sounds like fun, right? People [have done it](https://github.com/dominictarr/JSON.sh), though.
      Maybe it can be written in the language itself.

# Virtual Machine Shim for [`libcrun`](https://github.com/containers/crun)

Using containers on a development machine is fun if it is a Linux machine.
Otherwise, one has to resort to virtual machines. 

Lately, I've grown to appreciate having less dependencies that require separate
installation. For that reason, relying on docker, podman, runc, crun or other
tools as binaries doesn't seem attractive anymore. I want to be able to use
`libcrun` on both Linux and macOS alike. With no change in API. Perhaps even
use Virtualization Framework on macOS [^virtualization-framework].

[^virtualization-framework]: I know it doesn't have a great API and it has tons of deficiencies. But I think I may have a workaround or two.
