---
date: 2023-04-04
categories:
  - Postgres
  - Omnigres
  - contest
---

# Make Postgres an Application Server, Gamified

Have you ever wondered if Postgres can be a fully self-sufficient platform for your
application? Learn how to make it become an application server and win some prizes, too!

<!-- more -->

## Intro

[Omnigres](https://github.com/omnigres/omnigres) is a project with the goal of making Postgres
a complete platform for developing and deploying applications. It enables colocating your business
logic with the data and exploit the benefits of such an approach. It's very early but it is already
showing promise and is ready for some _early adopters_!

The focus of this first, __informal contest__ is to explore its HTTP server
capabilities. With _omni_httpd_ one can serve HTTP requests using SQL queries.

!!! question "What's the deadline?"

    It will end May 1, 2023 unless extended further.

## Brief 

In its [documentation](https://docs.omnigres.org/) there is an example [MOTD service](https://docs.omnigres.org/examples/motd/)
that is barely scratching the surface of what's possible. This is where we start. You can find the copy of the code below, too.

??? example "MOTD service code"

    ```postgresql
    {% include "motd_1.sql" %}
    ```

Your objective is to solve one or more of the following challenges:

## Challenges

!!! tip

    Be the first one to solve either challenge to win a prize.

### #1: Make it Serve HTML and JSON

Depending on the `Accept` header (and/or query path/string), make the service render HTML or JSON for a MOTD.

For example:

```
$ curl --header "Accept: application/json" http://localhost:8080
{"content": "...", "posted_at": "..."}
```

### #2: Authorized User Updates

Make it possible to update MOTD only by authorized users. It's up to you how you define "authorized" but be reasonable!

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

## Where to Learn?

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
