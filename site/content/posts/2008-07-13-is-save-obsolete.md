---
title: "Is “Save” Obsolete?"
date: 2008-07-13
permalink: /blog/2008/07/13/is-save-obsolete/
tags:
  - databases
  - StrokeDB
excerpt: "Leaving my hangover apart, I want to talk about some recent \"realization\" I had. I am not sure it is necessarily a good idea, but it might be worth some investigation. So here we go."
series: From the archive
original: https://web.archive.org/web/20081113104803/http://www.rashkovskii.com/2008/07/is-save-obsolet.html
originalVenue: rashkovskii.com
---
Leaving my hangover apart, I want to talk about some recent "realization" I had. I am not sure it is necessarily a good idea, but it might be worth some investigation. So here we go.

In those ORMs I know (I do not pretend to know all of them, and I had an extensive experience only with few of them, mostly in Ruby) your way to operate with your objects' persistency is basically a read-edit-save loop (RESL). There is nothing bad about this way, especially given that you have no built-in versioning in typical relational databases and ORMs.

But as you may know, we at [idbns](http://idbns.com/) team are experimenting with some weird ideas and prototypes (like [StrokeDB](http://strokedb.com/)) and one of the things we definitely love about our approach to data management is a built-in versioning.

At this moment, StrokeDB implements this RESL thing, too. It is a quite common approach, but it isn't any fun. It does work with versioning pretty well — it just increments document version once you save — nothing really tricky.

But there is one thing. My own viewpoint that I've developed within past few years is that your persistency mechanism should not let you "separate" your objects from your [programming environment](/blog/2008/05/16/we-dont-need-a-database/). So why the hell should I remind my programming environment to persist object's change every time I modify it? Wouldn't it be nice to persist data transparently?

May be. There is nothing new about this idea, but as far as I understand, there is not much public use of it in the industry.

Let's try to see where will it lead us to. Given we have built-in versioning, every change (like slot's value change) will cause versions change quite frequently, and, what is more important, these versions will be pretty much pointless. You will have a great history of every single change, but you wouldn't be able to say "and here we did that" for any more-than-one-slot update.

Unless you describe it explicitly. What if we'll make a record for every "business operation", something like a document that says:

- this operation was performed at Jul 13, 2008 04:17AM PST
- this operation was "week expenses adjustment"
- this operation was performed on document 61fe324e-3e6e-49e8-9427-6ebab7c31ff9
- this operation starts at version 164c2a4b-294a-4253-97e7-124cc1e4a1cc and ends at version 9d888a2a-7f69-40ae-83c6-c55262d89d99

It seems that having such kind of an explicit records will also allow us to run some kind of smart and safe compaction on a database.

I am not sure about the whole idea, but it still sounds interesting for me. What do **you** think?
