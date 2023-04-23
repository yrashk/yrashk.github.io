---
date: 2023-04-23
categories:
  - Postgres
  - Omnigres
---

# Structured Postgres Regression Tests 

I've been using `pg_regress` tests for a while. It's generally a great way to ensure
the behavior of your Postgres code works and continues working as expected. However,
as my tests became larger, I started getting lost in them; and there are limits as to
what you can test by having a `psql` session.

<!-- more -->

If you don't know, `pg_regress` basically takes an SQL file you give to it and sends it
to `psql` running against a Postgres instance (either managed by `pg_regress` or by you)
and compares the output against a previous stored execution log. If there are no differences,
all is good (aka _"tests passed"_.)

But I found that at least in my practice, tests tend to become rather large and it's hard
to find separation between steps, individual tests and so on. Of course, you can put every
individual test into a separate file, but that feels like a bandaid.

So I thought, _"how can I structure this better? There must be a way."_

My hunch was that if I can put both inputs (queries) and outputs (results,
errors, etc.) into a machine-processable format that is also very
visual, I can do a lot with it. I didn't want to write JSON, though. It
doesn't force you into having a visual structure.

Unsurprisingly, __YAML__ fit the bill. As much as I may not be its fan (it has design flaws and is
definitely being overused for, _uhm_, "programming"), but it does provide a good visual structure,
can be essentially queried and has some interesting features like tags and anchors. And, importantly,
it has pretty good support for multiline strings[^multiline]!

[^multiline]: not a lot of queries easily fit into a single line, so...

So, instead of having something like this in your test:

```postgresql
select true as value
 value
-------
    t
(1 row)    
```

...what if you can have something a bit more structured?


```yaml
query: select true as value
results:
- value: t
```

At this point I got excited and decided that there's no going back and [`pg_yregress`](https://docs.omnigres.org/pg_yregress/usage/)
was prototyped.

By focusing on the structure one can feed into it, one can provide a lot of information to it, such as:

* __configuration__ of the instances to be tested against
* initialization sequences
* __reusable queries__ (_hello, YAML aliases!_)
* sending tests to __multiple instances__ (_want to test a replication scenario?_)[^is-it-ready]

[^is-it-ready]: Not all features are ready, please be patient or consider contributing. I'll get to it if you don't!

Unlike `pg_regress`, it doesn't use `psql` and this opens some interesting opportunities. For example, it can be used to [test binary
encodings](https://docs.omnigres.org/pg_yregress/usage/#binary-format) as it simply uses `libpq`:

```yaml
query: select true as value
binary: true
results:
- value: 0x01
```

Also, it wraps queries into transactions by default[^txn], which removes a lot of `begin`/`rollback` noise in `pg_regress`-based tests.

[^txn]: Actually, there's no way to turn this behavior off right now, but it'll come soon as it is a trivial change.

It's still pretty new and rough around edges but I am already migrating [Omnigres](https://omnigr.es/) to it and will continue adding
necessary features and improving the user experience. Check out the [documentation](https://docs.omnigres.org/pg_yregress/usage) if you
are interested.

_Feedback, suggestions and contributions will be appreciated, so don't be shy!_
