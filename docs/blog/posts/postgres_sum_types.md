---
date: 2023-04-09
categories:
  - Postgres
  - Omnigres
  - types
---

# Sum Types in Postgres

At times, representing the variety of types a value can take through multiple tables can taxing, both
in terms of development complexity as well as, potentially, performance. You must just need a value
to be of any of the given variants. I've set out to build a generalized mechanism for defining these. 

<!-- more -->

!!! question "Can you give me an example?"

    Sure. Let's say we want to store geometric primitives[^postgis] and be able to find certain shapes
    with certain properties.

    One can put different shapes into different tables or even use multiple columns per shape type. But
    this makes the schema fairly complicated.

    Wouldn't it be cool to just store any shape in a single column?

    [^postgis]: PostGIS has its own `geometry` type but I am using this is an example.

## Intro

I am working on [making Postgres a full-featured application development platform](https://github.com/omnigres/omnigres),
so this issue came up a few times. For example, I want to be able to return different [_kinds_ of responses to HTTP requests](https://docs.omnigres.org/omni_httpd/intro/),
like upgrading to WebSockets, delaying a response, terminating a connection, etc. The `http_response` type is limited to conventional responses.

So I thought, _is it possible to support this type of thing in Postgres?_ I develop a number of extensions and have used
its C API surface extensively. I was pretty sure this can be achieved! A few days later, the support has materialized.

The basic idea is simple: 

* Register a base type for every sum type and list all variant types OIDs in extension's configuration
* If all variants are fixed size, sum type is also fixed size of the largest variant (plus discriminant)
* Use underlying variant type's I/O functions
* Dispatch I/O and conversion functions to generalized implementations provided by the extension[^ext]

It's been a pretty fun experience connecting all the dots and using C API to define types, functions, casts, etc.

[^ext]: `omni_types` extension in Omnigres

The way it works is pretty simple:

```postgresql
omni_types=# select omni_types.sum_type('geom', 'point', 'circle');
sum_type
----------
 geom
(1 row)
```

Now we have a type we can do something with:

```postgresql
omni_types=# create table geoms as values 
('point(10,10)'::geom),('circle(<10,10,10>)'::geom),('circle(<20,10,10>)'::geom);
SELECT 3
```

Let's select all shapes that have an X coordinate set to 10:

```postgresql
omni_types=# select * from geoms where
                  (omni_types.variant(column1) = 'point'::regtype 
                   and (column1::point)[0] = 10) 
               or (omni_types.variant(column1) = 'circle'::regtype 
                   and (point(column1::circle))[0] = 10);
       column1
----------------------
 point((10,10))
 circle(<(10,10),10>)
(2 rows)
```

There are still a few issues to work out ([{--adding binary send/recv support--}](https://github.com/omnigres/omnigres/pull/149),
[{--ensuring proper TOAST support--}](https://github.com/omnigres/omnigres/pull/145), convenience API, etc.) but I think it's a worthy prototype to play with. 

## Try it out

You can try it out as part of latest Omnigres builds:

```shell
docker volume create omnigres
docker run --name omnigres -e POSTGRES_PASSWORD=omnigres -e POSTGRES_USER=omnigres \
                           -e POSTGRES_DB=omnigres --mount source=omnigres,target=/var/lib/postgresql/data \
           -p 5432:5432 -p 8080:8080 --rm ghcr.io/omnigres/omnigres-slim:latest
# Now you can connect to it:
psql -h localhost -p 5432 -U omnigres omnigres # password is `omnigres`
```

In `psql`:

```postgresql
omnigres=# create extension omni_types;
```

You can read more about using the sum types in the [documentation](https://docs.omnigres.org/omni_types/sum_types/).
