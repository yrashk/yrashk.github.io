---
date: 2023-07-20
categories:
  - Omnigres
  - D3X
---

# Omnigres Developer Experience

Software developer's job is not an easy one; anything that makes it less
frustrating and makes developers more productive is highly sought for. This is why
the most successful developer tools are usually the ones that have an amazing
developer experience.

[Omnigres](https://omnigres.com) turns Postgres into a complete Application
Platform, and by doing that, we must focus on _Development, Debugging and
Deployment Experience (D3X)_ as the #1 priority.

<!-- more -->

Mature databases, such as Postgres, come with a very specific,
database-centric experience. It can be attributed to the fact that we are all
used to having database workflows distinct from our development activities
(because they are considered to be _separate_ things), inertia and tradition.

One of the core idea in Omnigres is that your database can run your application, too.
There are many reasons for that (performance, simpler and cheaper deployment,
atomic migrations, etc.). What's important is that this means we have to make the development
experience of this approach familiar, smooth and, dare I say, a bit magical.

Omnigres is still a young project. It has already contributed to an improved experience,
but let's __peak into the future__ and see a more complete picture of where it's going.

## Where do we start?

Every project has to begin somewhere. We're taking cues from most popular
tools. It should be possible to create and run projects as simply as running
the following commands:


```shell
$ omnigres init
$ omnigres run
```

That's it, at this point you have an application that you can access over HTTP. Omnigres
has its own HTTP server built in with WebSocket support.

This tool will also handle provisioning and running Postgres installations under
the hood. Simply change the desired version in the generated config file, and
you're running a version you need.

## Managing schema migrations

You don't really need an external tool to run incremental migrations,
your database is perfectly capable of doing that. [omni_schema](https://docs.omnigres.org/omni_schema/reference/)
loads all your migration files in the correct order. Similar to many projects, simply put
an order-prefixed (`1_create_users.sql`, `2_add_deleted_at_to_users.sql` or a
timestamp if you prefer) SQL files into a `migrations` directory and
the tooling will pick those up to run the migrations.

And for cases where incremental migrations can be unambiguously deduced
from a DDL (with hints or without), it can make your life even easier: simply
edit your `create table` statement in place.

## Putting functionality into Postgres

One of the reasons people avoid putting functions inside of Postgres is that
the very experience of doing so can be frustrating. Should they be part of incremental
migrations to ensure they are used with the correct data model? Should they be deployed separately?

Since we don't really need to change functions incrementally, functions can be
simply reloaded from a single source of truth. That's what
`omni_schema` already [does, and not just for
functions](https://docs.omnigres.org/omni_schema/reference/#object-reloading).
It simply gets the new definitions override the old ones as part of the routine
migration process.


## Bring Your Own Language

Postgres already supports a few languages one can write functions in (PL/pgSQL,
Python, Perl, Rust, JavaScript, Java, Tcl) and more are coming [^more-lang].

[^more-lang]: I've recently started work on [omni_prolog](https://github.com/omnigres/omnigres/pull/215). How about some expert systems
inside Postgres?

But you know what sucks the most today when you have to write a function in one of those languages?
You have to stick it inside of SQL and your editors are mostly not very helpful after that, as this
is no longer a [Python | JavaScript | Rust] file.

```postgresql hl_lines="4-8"
create function pymax(a integer, b integer)
  returns integer
as $$
  if (a is None) or (b is None):
    return None
  if a > b:
    return a
  return b
$$ language plpython3;
```

However, the tooling can simply find your `.py`, `.js` (or other language) files and
create SQL functions out of them.

## How do I develop my web applications end-to-end?

Without prescribing a single best approach (there probably isn't!), Omnigres offers a few components
and approaches:

* HTML templates
* REST/GraphQL integration
* Over-the-wire components (similar to [Phoenix LiveVew](https://github.com/phoenixframework/phoenix_live_view))
* Integrated UI framework ([SQLPage](https://sql.ophir.dev/) is a source of inspiration)  

As with functions, all of these are developed in regular files so that the experience is
familiar and convenient.

## How do my files get to deployment?

Aha, that's a great question! 

We use a virtual file system extension, [omni_vfs](https://docs.omnigres.org/omni_vfs/reference/)
and `omni_git` to take your files with you. Once you are ready to deploy you make your database
do a Git pull (`select omni_git.pull(...)`) and the files are getting accessed using a _Git VFS_
in production as opposed to _local VFS_ when you are developing.

And this doesn't only apply to migration-related files. Your templates, static assets, all of that
can be retrieved this way.

## Augmenting Postgres

Arguably, one of the most exciting things about Postgres is its ecosystem of
extensions that keeps growing. From geo-informational systems and time series
to machine learning!

However, installing extensions easily and reliably across platforms is
something that stops a lot of people as extensions maybe non-trivial to build
(they have external requirements) and managing that both for development
(everybody's machine and environment is subtly different) and production can be
frustrating.

It really should be as simple as doing something like this:

``` shell
$ pgpm add vector
```

and having it stored in your config, downloaded/built for your local development experience
and automatically rolled out when deployed. We're taking a lot of cues from Rust's cargo here.

As opposed to some other approaches, pgpm[^pgpm] is focused on configuring, building and packaging natively,
without relying on isolated environments (such as Docker) so that you can run the extensions without having
Postgres contained. It's an expert configuration system, if you will.

[^pgpm]: Postgres Package Manager, currently a work-in-progress

## Reactive Queries

Data is often treated as inert matter. We write it down and until we query
against it, it just sits there.

But the reality we're building applications for is complicated. We want data to
have effects outside of a single transaction's scope. For example, what if we
wanted to notify inactive users or run an onboarding campaign that is
tailored to what the user is doing and their patterns?

The idea behind reactive queries is that you can define what must happen should
certain condition occur at some point. It's kind of like triggers but for sets
of conditions as opposed to being bound to a particular entity.

## Job queueing

There are things we shouldn't do while handling a request, especially when they
take time and we don't need an immediate output. So, instead of having to manage
an external job server (and maybe even Redis for it?) Omnigres has an embedded job
server that uses local and remote workers to complete these. Jobs benefit from being
close to data and can be trigerred by reactive queries, too.

## Scaling

Even though your need in extra computing goes down when performance is higher, you will
need to scale at some point. Building on and augmenting Postgres' own replication facilities,
Omnigres can grow your deployment smoothly. Having control over migrations workflow gives us 
better control over scaling roll out and schema synchronization.

Beyond physical and logical replication, novel approaches like Neon DB can also facilitate
beter scaling and elastic resource use.

Think about it this way: Omnigres is ultimately an application server with a database inside.
That database's replication, foreign data wrappers and elastic provisioning allows the application
server to scale horizontally.

## What do I do with legacy pieces?

Don't throw them out! Also, you don't have to rewrite them right away, either. Omnigres platform can also
be used as a manager/orchestrator for external components (like containers[^omni_containers]) so that you maintain the source of truth
in a single place and can query against or sent traffic to these components based on the data you have.

[^omni_containers]: There's [omni_containers extension](https://github.com/omnigres/omnigres/tree/master/extensions/omni_containers) already,
but it's not quite documented yet.

# Where are we at?

Some of the described functionality is already there, some is the works, some are being researched and others are just
a vision at the moment. You can find a bit more progress clarity on this [roadmap](https://github.com/omnigres/omnigres#building_construction-component-roadmap).
