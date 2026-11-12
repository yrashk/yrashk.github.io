---
title: "We Don’t Need a “Database”"
date: 2008-05-16
permalink: /blog/2008/05/16/we-dont-need-a-database/
tags:
  - databases
  - StrokeDB
excerpt: "I’ve been trying to formulate what StrokeDB is recently. And here is my summary: StrokeDB is not a database; it is a programming environment on top of Ruby."
series: From the archive
original: https://web.archive.org/web/20080521021231/http://rashkovskii.com/articles/2008/5/16/we-don-t-need-a-database
originalVenue: rashkovskii.com
---
I’ve been trying to formulate what [StrokeDB](http://strokedb.com/) is recently. And here is my summary: StrokeDB is not a database; it is a programming environment on top of Ruby (until we’ll have it ported to other languages). And here are my thoughts about “database” concept.

Do we **really** need “databases”? Well, I mean, we surely need some toolset to be able to store and retrieve data, but who said we need it in a form of pure datasets to be stored and retrieved? Who said that there should be a database server to interact with? Who said we might need special domain languages designed to manipulate arbitrary data?

What we **really** need is a persistence-aware programming environment, aren’t we? We just need to be able to store and retrieve data no matter how its persistence handled internally. There is nothing new about it, actually — MUMPS and GemStone/S (or even PL/SQL) were around for decades. What we **really** might need is to be able to create your-application-data-domain specific languages without any hassles — since we need to manipulate application’s data, not just **any** data (like you basically do with SQL).

It is quite popular in Rails world to say that we need a *stupid* database, just a kind of storage and let Ruby do the rest. Basically, they have a point. They use RDBMS as a data storage layer and their database is actually *smart*, because what is really important for data handling is actually implemented in Ruby. It is still usually limited by RDBMS design constraints, though.

My point is that your data should be as close to your main programming environment as it is possible. Your structures should be as *native* as it is possible — and they should be handled within the same environment. That’s reminds things like PL/SQL. Basically, PL/SQL is not THAT bad, but the thing with it is that usually you was using not ONLY PL/SQL, but, say, some Java code to interoperate with Oracle database.

> Your application itself **IS** a *smart* database.

So, I’d say we’re in the beginning of the long way “back to the future” — persistence-aware programming environments, not just *databases*.

Viva **smart** databases!

P.S. I am going to blog about data organization concepts within such environments soon — that’s an interesting topic to talk about and it is surely more concrete than this one :)
