---
title: "Top 10 Reasons to Avoid Document Databases FUD"
date: 2008-04-26
permalink: /blog/2008/04/26/top-10-reasons-to-avoid-document-databases-fud/
tags:
  - databases
  - StrokeDB
excerpt: "First of all I’d like to note that the below answers are not about SimpleDB but rather to prevent FUD about document-based databases."
series: From the archive
original: https://web.archive.org/web/20080430214123/http://rashkovskii.com/articles/2008/4/26/top-10-reasons-to-avoid-document-databases-fud
originalVenue: rashkovskii.com
---
This article is written in response to [Top 10 Reasons to Avoid the SimpleDB Hype](http://www.ryanpark.org/2008/04/top-10-avoid-the-simpledb-hype.html)

First of all I’d like to note that the below answers are not about SimpleDB but rather to prevent FUD about document-based databases.

## 1. Data integrity is not guaranteed.

This could be the case with SimpleDB, but overall nothing prevents document databases from managing data integrity very well.

Regarding the constraints, there is nothing that prevents defining validations in a document or its related “meta” document (this is pretty much how [StrokeDB](http://strokedb.com/) works — you can define your validations within meta document and they will let your document stay validated)

More interesting are the concerns about the conflicts. I’d say that this problem is hardly addressed in a common RDBMS approach. All you usually get is either user’s A or user’s B most recent update — there seems to be no easy way graceful conflict resulution. On the contrary, since document databases approach is rather novel there is certainly enough room to adopt ways to deal with conflicts. For example, with different and configurable algorithms — like merging them slot-by-slot 3-ways, or even some special programmer-defined algorithms. I can hardly imagine how to do this sort of stuff with traditional RDBMS in a relatively easy manner.

## 2. Inconsistency will provide a terrible user experience.

First of all, it should noted that described inconsistencies are also quite possible with distributed RDBMS setups — they too are constrained by a certain lag before the data is going to be propagated through replicas.

The actual problem is not with lag — it is more about leaving documents in a consistent state.

This problem could be easily addressed in any kind of database, either relational or document-based.

## 3. Aggregate operations will require more coding.

Again, while this seems to be true for SimpleDB, other document-based databases address this problem pretty well with Views approach ([CouchDB](http://incubator.apache.org/couchdb/), StrokeDB \[Views is WIP\]) — so you can define any kind of aggregation, even such that are simply not supported by RDBMS.

## 4. Complicated reports, and ad hoc queries, will require a lot more coding.

I’d refer to Views approach once again — it is quite a nice way to produce complicated reports as quickly as well-known RDBMS indexes do.

“Views” could be viewed as subroutines with a special well-defined API — and we can use these subroutines to index specific “queries” even in runtime. That’s pretty interesting.

## 5. Aggregate operations will be much slower if you don’t use an RDBMS.

This is a dubious statement. First, for the majority of the queries speed is defined by the speed of the index (all that B+ trees stuff). Document-oriented database views are indexed the very same way.

Speaking of those RDBMS “rows” and objects I wouldn’t say they are much different. An Object with key/value pairs slots is definitely a “row” in that sense. So what’s so different about them?

On the other hand, “real” relational database should actually use aggregating operations (joins) far more frequently than typical document database. Relational database is basically about storing short “facts” with relations between them and using lots of join operations to aggregate synthetic data. That wouldn’t be efficient/easy enough to program though — that is why most of relational database in the “real world” are organized in the form of fairly wide tables.

And, finally, for the well-done DODBs it is possible to use nice Map-Reduce API to build and incrementally update very complex aggregations.

## 6. Data import, export, and backup will be slow and difficult.

“There are no such tools for key-value data stores, because these products are so new.”

Is lack of maturity a good reason to blame new technologies?

SimpleDB implementation in particular might have its own flaws in this area — but nothing prevents it from improving things in theory and practice.

## 7. SimpleDB isn’t that fast.

Since this this post I am talking about document databases in general, I’d skip those “internet latency” issues. It’s kinda irrelevant.

## 8. Relational databases are scalable, even with massive data sets.

The main argument here is that “those guys do scale relational database, so they are scalable”. True. They are scalable. But at what cost? “Those guys” were able to do a lot of great stuff utilizing manpower before letting machinery do this back tens years ago. But is it a good excuse to manufacture goods without machinery these days just because it is possible? I doubt it. Throwing man power at a problem is not always the best approach.

And… you said “relational”? Facebook and others do a lot of denormalization, they don’t **ever** use JOIN, they’d rather do several consequent requests and build intermediate results on a webserver (when you have 20 times more webservers than DBs it’s obviously good to move some load there). They treat good old MySQL as object storage with very fast B+ tree indexes. Finally, the resulting database is **not** a relational one. One thousand of MySQLs is just a distributed object storage with simple fast indexes and a bunch of hand-written code in php/ruby/python/whatever around it.

## 9. Super-scalability is overrated. Slowing the pace of your product development is even worse.

Super-scalability issue is not really overrated. The problem with the approach of “why not wait and address super-scalability once you’ve created a super product” is that once you will address super-scalability, it will be quite a different product.

The issue with scalability these days is that less scalable applications are quite different from the the ones that are hugely scalable — and that is why writing a scalable application from the scratch is definitely a waste of time and money.

But what if scaling from SQLite-like backend to 2 datacenters will be quite painless and will not require you to rethink database interactions in your application? With the right database API design it is quite possible. BigTable, Amazon Dynamo, CouchDB, StrokeDB approaches are all about addressing this need.

## 10. SimpleDB is useful, but only in certain contexts.

Same can be said for relational databases. In the real world, data is not really well structured — it is rather versatile and it’s repsentation depends on point of view. This problem is very well addressed by document databases (and StrokeDB in particular was created in attempts to solve this problem).

“Amazon SimpleDB, Apache CouchDB, and the Google Datastore API aren’t bad products. But we do them a disservice when we construe them to be replacements for general-purpose databases. Used carefully, they can help your organization. But used indiscriminately, you’ll create a lot more work for your programmers and you’ll make your application perform even worse”

Relational databases are not bad products either. Used carefully, they can help your organization. But used indiscriminately, you’ll create a lot more work for your programmers and you’ll make your application development even more complex.
