---
title: Make Postgres an Application Server, Gamified
date: 2023-04-04
permalink: /blog/2023/04/04/make-postgres-an-application-server-gamified/
tags:
  - Postgres
  - Omnigres
  - contest
excerpt: "Have you ever wondered if Postgres can be a fully self-sufficient platform for your application? Learn how to make it become an application server and win some prizes, too!"
---
Have you ever wondered if Postgres can be a fully self-sufficient platform for your
application? Learn how to make it become an application server and win some prizes, too!

## Intro

[Omnigres](https://github.com/omnigres/omnigres) is a project with the goal of making Postgres
a complete platform for developing and deploying applications. It enables colocating your business
logic with the data and exploit the benefits of such an approach. It's very early but it is already
showing promise and is ready for some _early adopters_!

The focus of this first, __informal contest__ is to explore its HTTP server
capabilities. With _omni_httpd_ one can serve HTTP requests using SQL queries.

::: question What's the deadline?

It will end May 1, 2023 unless extended further.
:::

## Brief 

In its [documentation](https://docs.omnigres.org/) there is an example [MOTD service](https://docs.omnigres.org/examples/motd/)
that is barely scratching the surface of what's possible. This is where we start. You can find the copy of the code below, too.

::: details example MOTD service code

```postgresql
-- MOTDs stored here
create table if not exists motd
(
    id        int primary key generated always as identity,
    content   text,
    posted_at timestamp default now()
);

-- Shows last MOTD
create or replace function show_motd() returns setof omni_httpd.http_response as
$$
select
    omni_httpd.http_response('Posted at ' || posted_at || E'\n' || content)
from
    motd
order by
    posted_at desc
limit 1;
$$ language sql;

-- Shows when there are no MOTDs
create or replace function no_motd() returns setof omni_httpd.http_response as
$$
select omni_httpd.http_response('No MOTD');
$$
    language sql;

-- Creates a new MOTD 
create or replace function update_motd(request omni_httpd.http_request) returns omni_httpd.http_response as
$$
insert
into
    motd (content)
values
    (convert_from(request.body, 'UTF8'))
returning omni_httpd.http_response(status => 201);
$$
    language sql;

-- Handlers
update omni_httpd.handlers
set
    query = (select
                 omni_httpd.cascading_query(name, query order by priority desc nulls last)
             from
                 (values
                      -- GET
                      ('show', $$select show_motd() from request where request.method = 'GET'$$, 1),
                      -- POST
                      ('update', $$select update_motd(request.*) from request where request.method = 'POST'$$, 1),
                      -- No MOTDs
                      ('fallback', $$select no_motd() from request where request.method = 'GET'$$,
                       0)) handlers(name, query, priority));
```
:::

Your objective is to solve one or more of the following challenges:

## Challenges

::: tip

Be the first one to solve either challenge to win a prize.
:::

### #1: Make it Serve HTML and JSON

Depending on the `Accept` header (and/or query path/string), make the service render HTML or JSON for a MOTD.

For example:

```
$ curl --header "Accept: application/json" http://localhost:8080
{"content": "...", "posted_at": "..."}
```

::: details success First prize claimed

[@ggaughan solved it first](https://github.com/yrashk/yrashk.github.io/discussions/1#discussioncomment-5529719). You can still
get the Finisher's prize.
:::

### #2: Authorized User Updates

Make it possible to update MOTD only by authorized users. It's up to you how you define "authorized" but be reasonable!

::: details success First prize claimed

[@kartikynwa solved it first](https://github.com/yrashk/yrashk.github.io/discussions/1#discussioncomment-5542003). You can still
get the Finisher's prize.
:::

### #3: Separate Rooms

Instead of having one global MOTD, allow updating MOTD by "rooms" (room name can be derived from the path or the query string).

For example: 

```
POST /omnigres "Check out Omnigres" # => HTTP/1.1 201 OK
POST /postgres "We're all waiting for Postgres 16" # => HTTP/1.1 201 OK

GET /postgres # => HTTP/1.1 200 OK
Posted at 2023-04-04 08:01:23:13.617115
We're all waiting for Postgres 16

GET /postgres # => HTTP/1.1 200 OK
Posted at 2023-04-04 08:01:23:13.317115
Check out Omnigres
```

::: details success First prize claimed

[@ggaughan solved it first](https://github.com/yrashk/yrashk.github.io/discussions/1#discussioncomment-5531309). You can still
get the Finisher's prize.
:::

### Surprise Challenge

Build something not listed in the above challenges and make it awesome. First three entries win!

## Where to Learn?

The easiest way to start Omnigres is to use a [container image](https://docs.omnigres.org/quick_start/):

:::: tabs
::: tab Default image

⚠️ The image below is rather _large (over 8Gb)_. If you prefer a smaller one, select the next tab.

```shell
docker volume create omnigres
docker run --name omnigres -e POSTGRES_PASSWORD=omnigres -e POSTGRES_USER=omnigres \
                            -e POSTGRES_DB=omnigres --mount source=omnigres,target=/var/lib/postgresql/data \
            -p 5432:5432 -p 8080:8080 --rm ghcr.io/omnigres/omnigres:latest
# Now you can connect to it:
psql -h localhost -p 5432 -U omnigres omnigres # password is `omnigres`
```
:::
::: tab Slim image

```shell
docker volume create omnigres
docker run --name omnigres -e POSTGRES_PASSWORD=omnigres -e POSTGRES_USER=omnigres \
                           -e POSTGRES_DB=omnigres --mount source=omnigres,target=/var/lib/postgresql/data \
           -p 5432:5432 -p 8080:8080 --rm ghcr.io/omnigres/omnigres-slim:latest
# Now you can connect to it:
psql -h localhost -p 5432 -U omnigres omnigres # password is `omnigres`
```
:::
::::

Please refer to [Omnigres documentation](https://docs.omnigres.org) or drop by
[our Discord server](https://discord.gg/Jghrq588qS) to ask questions.

## Prizes

### First 

Solving any challenge first gives you a prize of $30 USD or a comparable equivalent.
It also includes the Finisher's prize.

### Finisher

Solving any challenge gives you a shout out in the post, Twitter and other media. Your name
will be documented in Omnigres documentation where we'll record this contest for posterity.

### Surprise

You built something not listed in the above challenges and it is awesome? There are three $50 prizes for this,
one for each entry! Includes the Finisher's prize.

## Solution Submissions

Please post your solution somewhere like [Github Gist](https://gist.github.com/) and post in a comment below this post.
