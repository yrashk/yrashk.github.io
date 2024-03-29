These are some of the projects I would like to work on, but haven't started yet. If any of these
sound exciting to you and you'd like them to be implemented, please consider [sponsoring my work](https://github.com/sponsors/yrashk) [^sponsor].

[^sponsor]: You can create a custom monthly or one-time amount. Send me a [message](mailto:yrashk@gmail.com) to discuss details.

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

## Object Synomyms

Sometimes naming objects the way they were designed (either in Postgres or in
an extension) is problematic, especially when you need to qualify name
to the schema or import the whole schema by adding it to search path.

Oracle has support for
[synonyms](https://docs.oracle.com/en/database/oracle/oracle-database/21/admin/managing-views-sequences-and-synonyms.html#GUID-F66725AA-B410-49EA-9C96-CF5C408879F1)
for this exact reason.

Postgres doesn't, but it'd be great to have it.


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

# Better C as a C superset 

!!! tip "Codename "Spicy Language""

Some people have tried to solve C's problems by creating new languages
([Zig](https://ziglang.org), [D](https://dlang.org/spec/betterc.html)), some
went even a bit further than just C ([Rust](https://rust-lang.org/),
[Nim](https://nim-lang.org/)) but I wonder if C itself can be saved
using some _magic_. I really don't fancy the idea of keeping rewriting
libraries in the new languages every couple of years.

What I want is _Better C_ that is still 100% C. That is, it compiles existing C
code just fine. It doesn't change any of the existing semantics.  But it does
offer extra features on top of it. 

First thing I would like to fix is with regard to the flat namespaces and
conflicts. Perhaps something along the lines of _namespaces_ (especially for
dependencies), external symbol renaming, etc. These things make our lives just
miserable at the worst time.

I'd like it to fix scope exits (without out-of-order statements), and a few other things.

It can also perhaps with minor annoyances of C such as the necessity for forward
declarations.

It'd be great to implement Spicy as a set of __syntax transformers__ that can
operate both on the source code level but also preserve state across
translation units to fix issues that arise outside of the translation unit
boundaries. It can be developed as a __drop-in replacement__ for `cc`, `ld` and
other tools to be aware of some of the user's intent [^ideas]. 

[^ideas]:  There are some fun ideas like delaying compiling object files until they are used for something so that
  they can be manipulated before the final steps.

# Virtual Machine Shim for [`libcrun`](https://github.com/containers/crun)

Using containers on a development machine is fun if it is a Linux machine.
Otherwise, one has to resort to virtual machines. 

Lately, I've grown to appreciate having less dependencies that require separate
installation. For that reason, relying on docker, podman, runc, crun or other
tools as binaries doesn't seem attractive anymore. I want to be able to use
`libcrun` on both Linux and macOS alike. With no change in API. Perhaps even
use Virtualization Framework on macOS [^virtualization-framework].

[^virtualization-framework]: I know it doesn't have a great API and it has tons of deficiencies. But I think I may have a workaround or two.

# Application Operating System

!!! tip "Codename "ParaOS""

We build software systems on top of many layers (in the name of focus,
efficiency and to avoid reinventing the wheel.) Battlefield-tested
foundation that addresses common needs is a great time, money and energy saver.

However, many of the layers we use today have been designed for a different
environment, needs and deployment size.

We (predominantly) write code in programming languages that were intended to
make programs that run on a single computer, put that code into files and
deploy instances of operating systems, the foundations of which were designed
about 50 years ago, primarily concerning itself with serving the resources (CPU
time, memory, persistence, networking and other peripherals) of an
underlying computer to multiple users and their programs.

The systems we develop these days span multiple nodes and heavily rely on
lage-scale, highly-available persistence capabilities as opposed to dealing
with local files, multiuser access, etc.

So, what if built an operating system for these applications?

Unlike traditional operating systems, this system would focus on providing
building blocks (operational guarantees, APIs, code mobility, etc.) for
building applications that span multiple computers as opposed to focusing on
serving the underlying hardware to applications as in programs in user space.

