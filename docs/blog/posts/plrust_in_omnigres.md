---
date: 2023-04-05
categories:
  - Postgres
  - Omnigres
  - Rust
  - Docker
  - containers
---

# PL/Rust Just Shipped: Easy Way to Try It Out

As a Rust enthusiast and a contributor to a [sister
project](https://github.com/tcdi/pgx) I am stoked about the release of PL/Rust
1.0.0 that was [just announced](https://github.com/tcdi/plrust/releases/tag/v1.0.0).

However, its setup instructions are rather long and it takes time to build it. So I
took the time to prepare a build for you to try.

<!-- more -->

As [Omnigres](https://github.com/omnigres/omnigres) is intended to be an
application platform, support for multiple languages is important. Hence I
decided to spend the day making sure PL/Rust is shipped with Omnigres. Omnigres
container image is simply a Postgres image with Omnigres extensions (and now
PL/Rust, too.) provisioned.


## Try it out now

You can start Omnigres with the following commands:

```psql
docker volume create omnigres
docker run --name omnigres -e POSTGRES_PASSWORD=omnigres -e POSTGRES_USER=omnigres \
                           -e POSTGRES_DB=omnigres --mount source=omnigres,target=/var/lib/postgresql/data \
           -p 5432:5432 -p 8080:8080 --rm ghcr.io/omnigres/omnigres:latest
# Now you can connect to it:
psql -h localhost -p 5432 -U omnigres omnigres # password is `omnigres`
```

That's it, now you can try this:

```postgresql
create extension plrust;

create function test() returns bool language plrust as $$ Ok(Some(true)) $$;

select test(); -- => t
```

It works! The sky is the limit now :smile: :simple-rust:


## What Have I Learned? 

I got up at 5AM today to make this happen. I am writing this past 5PM. It's been a long day, and I've made a lot of mistakes
on the way, and figured out some gotchas.

The amount of __space__ PL/Rust takes is rather not insignificant. I've measured about an _8Gb_ increase of the image size. While
it is not the end of the world for standard cases, this is something to be aware of [^1]. I've been told that there are some ideas on how
to improve the space usage but it'll never be really slim (Rust compiler itself is not small.)

If you're building PL/Rust in environments like __containers__, [make sure __`USER`__ environment variable is set](https://github.com/tcdi/plrust/issues/278).
It'll fail to build if it is not.

It also seems to be necessary to have at least __16GB RAM__ to build it. Not sure about memory requirements in runtime just yet.

__First-time function compilation__ takes an awfully long time. However, one can prime it ahead of time by compiling a test function in a throwaway database.
That's what I did in the image above.

---

It took a while to make sure the container works exactly how I want it to, but it was worth it!

[^1]:
    For those not needing the bulk (and Rust), I've added the __`omnigres-slim`__ version of the image. 
