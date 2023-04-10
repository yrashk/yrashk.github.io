---
date: 2023-04-10
categories:
  - Postgres
  - tips
---

# Avoiding Postgres Extensions Limitations

Postgres extensions are great. They enable fantastic use cases and bring new
capabilities to one of the most loved open source databases. But there are
edges in some of its features and this can be heard in conversations:
limitations of the upgrade system, lack of parameterized initialization, search
path/OID resolution issues, hard-wired dependency on `.control` files,
schema droppage [^droppage], etc.

However, the beauty of it is that what we _ultimately_ want from extensions does not
_need_ to use `CREATE EXTENSION`'s framework.

[^droppage]: Unless explicitly depended on afterwards

<!-- more -->

I've seen it a few times where newcomers to the extension world of Postgres learn to
understand the relationship between `.control`, `.sql` and `.so`
files. The questions I keep hearing are something like this: 

* _are extensions required to have an .so file?_
* _are SQL files required?_
* _where do we make users store metadata so that it doesn't get dropped accidentally?_

It's convenient to think about Postgres extensions feature as a whole, from
`CREATE EXTENSION` down to your functions. However, I think it hides the fact
that technically speaking, extension are a relatively thin mechanism on top of
some of the more fundamental capabilities that Postgres provides.

* It allows one to execute SQL (_duh!_)
* It allows to define functions that are contained in an `.so` file[^.so].

Postgres' [vanilla extension framework](https://www.postgresql.org/docs/current/extend-extensions.html)
reads the `.control` file, executes SQL scripts with a bit of quick-and-dirty
string value replacements (like `MODULE_PATHNAME` or `@extschema@`) and these
scripts deal with provisioning all that extension requires.

You can see most of this code in
[src/backend/commands/extension.c](https://doxygen.postgresql.org/extension_8c_source.html). You can
see that that code doesn't really deal with `.so` files. That code is actually
in
[src/backend/utils/fmgr/dfmgr.c](https://doxygen.postgresql.org/dfmgr_8c_source.html), like `load_external_function`.

What this means is that you don't really need to follow the path
charted by the framework to add that extended functionality to your database.
You can __roll your own upgrades__, you can can have __multiple `.so` files__
(instead of depending on `MODULE_PATHNAME`), you can call whatever
__initialization callbacks__ you want during installation, you __don't need
`.control` files__. You can think of a lot of your own cases.

What do you have to give up for this? You have to give up `CREATE EXTENSION`. Instead, you'd need
to do something like this:


```postgresql
psql=# select myextmgr.install('extension_name');
```

Which is probably not a big ask (_implementing the `install` function itself is a bigger
one!_). In fact, it may be even more interesting because one can use
this function over an entire dataset. For example, this will allow one to install multiple
extensions not known ahead of time.

!!! question "But..."

    > _How would we call `create function` and provide the path to `.so`
    files if it is not known ahead of time?_

    Great question. There are two ways I can see, depending on how deep you want to go:

    1. You can [`format()`](https://www.postgresql.org/docs/current/functions-string.html#FUNCTIONS-STRING-FORMAT)
       your `create function` query to supply the correct path with `%L`. I personally don't love it, but it's done a lot in PL/pgSQL.
    1. If you're writing this in C, there's [`ProcedureCreate`](https://doxygen.postgresql.org/pg__proc_8c.html#acb8cfc3bc78d5a1887fac3cda926274b).
       It has an ungodly number of parameters, but once you're through, it works really well!

A bigger thing you're potentially giving up here is that if you're developing
an extension that you want __others to use__ and it can't be fit into the mold
provided by vanilla Postgres extensions framework, well, you're presented with
a new challenge. You will need to find a way to convince your users to use
your installation method. Whether it is worth it entirely depends on whether
the limitations you're concerned about are worth overcoming.

[^.so]: Filename extension that means [shared object](https://en.wikipedia.org/wiki/Library_(computing)#Shared_libraries).
