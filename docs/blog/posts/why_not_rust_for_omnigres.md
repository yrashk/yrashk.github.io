---
date: 2023-01-07
categories:
  - Postgres
  - Omnigres
  - Rust
  - C
---

# Why not Rust for Omnigres?

[Omnigres](https://github.com/omnigres/omnigres) is a new project to turn
Postgres into a complete development and production deployment platform. I've
started it to reflect on the complexity and inefficiencies plaguing modern
business software development.

As an aging (and sometimes cranky!) developer, I crave simplicity. But that's a
topic for another post. Here I wanted to address a common question:

> **Why didn't you implement this in Rust?**

<!-- more -->

It's a great question, considering I've been using Rust for a number of years
now, and I generally advocate its use for its rich ecosystem, safety and
tooling. I [actively contribute](https://github.com/tcdi/pgx/pulls?q=is%3Apr+author%3Ayrashk+) to
[pgx](https://github.com/tcdi/pgx), a library for building Postgres extensions
in Rust. Yet, Omnigres appears to be all done in C.

Here's why.

*Beware: the list has a lot of subjective and controversial opinions.*

### Making a good wrapper (pgx) is a lot of work

While it's getting there, when you try to build something pushing the
boundaries, pgx may not yet provide sufficient API coverage, so you have to
resort to unsafe FFI. It drove me to make a number of contributions to it.
Still, since it takes a while to refine them enough to be considered
well-rounded, it impedes general development velocity.

Making a good, safe wrapper for such a complex project as Postgres is a
significant undertaking. It'll take however long it takes. That's why I am
wholeheartedly supporting it and spending time evolving it.

But as of today, I want to be able to move fast.

### Postgres is [quirky] C

Its whole internal API is designed to be consumed by C code, and Postgres
doesn't know anything about your other language.

It uses `setjmp/longjmp` for exceptions (so you'd have to roll your own guards
to unwind the stack). It has its own memory management system. It
manages the SPI stack. It has lots of mutable global variables!

So, to consume it from C is only natural, even though it can be dangerous.

### Dependencies

Between not really knowing what's inside of your dependencies and obnoxious
compile times, there's a reason for having less dependencies.

Rust's Cargo makes it terribly easy to add dependencies, so there's no tax on
adding yet another library. This is generally seen as a good thing in the
industry, but I keep coming back to the idea that less is better.

If, however, you had to pay for every dependency, we'd use a lot less of them,
only when necessary. C is excellent in this department! I gave up on a
number of dependencies simply because I had difficulties integrating them
into my build system. So I see this is a filter for the need *and* the
quality of the dependency.

### Fast compile times

Rust compiler is notoriously slow. Pgx brings its own complexity that makes
rapid iteration nearly impossible. My builds are extremely fast with C. It's a
simple language, and I tend to add very few dependencies.

### Complex language fatigue

I've been developing software for a few decades now and am growing tired of
complex languages. Going back to C feels like taking a vacation and stopping
chasing ideals and just focusing on the problem at hand.

If Postgres (or Linux kernel) can be done in C, I am sure a few extensions
could, too!

### Formal verification methods

There are projects that are focusing on bringing this to Rust, but there are
some great static analysis and formal verification tools that have been used in
C for quite a while. I fancy [Frama-C](https://frama-c.com) and try to add it
[bit](https://github.com/omnigres/omnigres/blob/a291b00172a5ce430a9536c21f4a78f2f98a0114/libgluepg_curl/libgluepg_curl.c#L46-L64)
by bit to Omnigres where I think it may be necessary.

### Rust safeties are slightly less relevant in Postgres

Postgres is inherently **single-threaded** and therefore, "fearless
concurrency" is not buying us much. Sure, you can build an extension that'll
communicate with other processes and threads over shared memory, but this is
not much of a concern at the core database level.

Postgres has its own **memory management** story, which is quite good. Instead
of having a single allocation pool, it has memory contexts that are established
temporarily or for a scope. When they are deleted, all the memory allocated in
them is released. So memory leaks are not necessarily a concern. Rust doesn't
necessarily consider leaks a safety issue, but it's nice to know we will not
crash the server with an OOM.

Of course, there's still use-after-free, which you have to be careful about.
This is where tools like AddressSanitizer can come in very handy.

I've seen that most of my crashes in the extensions were coming from misusing
some Postgres API, and I was getting a lot of them in Rust as well.

---

>**But Yurii, isn't C a dangerous and flawed language?**

Yes, it is both dangerous and flawed. In general, I wouldn't build new projects
in C, but after months of going back on forth on this, I think, ultimately,
building a project on top of Postgres in C is reasonable.

>Did you consider Zig?

I absolutely did. I am very interested in Zig (and have previously developed
some small projects in it) and I keep track of its development. But I
ultimately didn't want to fight both Postgres and Zig at the same time.

>Did you consider Nim?

You bet! The attraction was that it compiles to C, and I can emit C code where
necessary, obliterating the need to replicate certain tricks. But it's a
complex, big language, and I am not confident about its own bugs, obscurities
and upgrade stories (Nim 2 is coming!)

---

Knowing how Rust crowd behaves sometimes, there may be those inclined to
persuade me to change my opinion or prove me wrong. Of course, they are free to
do so, but I'd prefer to focus on getting things done!

**Ultimately**, I think Rust is great. Omnigres will have first-class support
for it and will promote its use and the use of
[pgx](https://github.com/tcdi/pgx) for building extensions.
