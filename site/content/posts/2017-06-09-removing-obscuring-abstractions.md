---
title: "Removing Obscuring Abstractions"
date: 2017-06-09
permalink: /blog/2017/06/09/removing-obscuring-abstractions/
tags:
  - PumpkinDB
  - databases
excerpt: "Well over a decade ago Chuck Moore mentioned an idea of “unnecessary abstractions”, abstractions that obscure the nature of the underlying concept."
original: https://medium.com/eventsourcing-publications/removing-obscuring-abstractions-392e74284e47
originalVenue: Eventsourcing Publications on Medium
---
![](/blog/posts/removing-obscuring-abstractions/1.jpg)

> **“…abstraction** is a technique for arranging complexity of computer systems. It works by establishing a level of complexity on which a person interacts with the system, suppressing the more complex details below the current level. The programmer works with an idealized interface (usually well defined) and can add additional levels of functionality that would otherwise be too complex to handle.” \
> *— Wikipedia*

Well over a decade ago Chuck Moore mentioned an idea of “unnecessary abstractions”, abstractions that obscure the nature of the underlying concept and he also talked a bit about how he writes code bottom up, defining whichever words (*instructions*) he deems to be useful, changing them as the understanding evolves.

This approach seems to be profoundly different from what most of us do. We are taught to be reasonably lazy and rely on existing libraries and tools as much as possible. After all, we are often required to ship as soon as possible. And I generally don’t disagree with that. Creating complex systems involving multiple domains is hard on its own, so the more code we can reuse, the better.

However, I do want to single out a category of tools that we use and argue that it is important to be able to cut through layers of abstractions and understand and appreciate the “physics” involved.

This category is **databases**. Arguably, a database is most commonly used and useful abstraction of all. It extends, persists and shares the memory available to our applications. The databases we use most tend to have a wide array of great functionality. Querying, indexing, distribution, fail-over, backups, you name it. These things work quite well (most of the time, in most cases). So why should we peek through these layers at all?

As Wikipedia defined it, abstractions *“suppress the more complex details”* and therefore removes the understanding of how things work further away from us, the users of the abstraction. While of course it is not a mystery or a particularly secret knowledge as to how any particular database operates (especially if you’re using open source), under the physical and psychological constraints of deadlines, it is so alluring to focus on the database abstraction itself and not think of the complexity involved. After all, that stuff *is* complex.

As a result, we end up having poorly modelled domains, inefficient queries, and start looking for [solutions that might be wrong](https://medium.com/@pk.patrick.kelly/youre-not-google-stop-trying-58b74137ad51).

My hunch is that by shaking off a few layers (it’s rather impractical to shake them all off) we can get just a bit closer “to the metal” and really appreciate what’s involved in storing, retrieving and finding data.

The level of abstraction at which I decided to stop here is a B+ tree key/value database. You can seek to the beginning, the end, a particular key prefix, and go to the previous or next key. Fairly compact abstraction surface, I would say. As an additional twist, [being an advocate for event sourcing, functional programming and immutability](/blog/2016/10/30/your-functional-programs-are-imperative-pumpkins/), I self-imposed one rule: no overwrites. I can associate a value to a key, but I can’t change it after that.

If you are familiar with the recent open source work I’ve been doing, yes, I am describing [PumpkinDB](http://pumpkindb.org).

I want to show you a small example. Please bear with its slightly artificiality and almost-intentional silliness (the hope is that one day I will have a better one!). This time I was playing with a design of a simple todo list. You can add items to the list, you can change their description, you can check them off or undo that. For the sake of simplicity, no deletion, no re-ordering.

How would I implement that given the architecture and limitations I described above?

Turns out, this is not very complex.

What’s the first thing to do here? Well, obviously, if we don’t add items to the list, this is not going to be a very useful list. So we need to record some key/value pairs that indicate just that. Let’s assume that for every new item we assign a random UUID. How can we record this in such a way that we can easily find all added items?

One way would be to combine some shared prefix (let’s say, `AddTodoItem`) with the UUID, leaving the associated value empty. But if you peek into the diagram below, you can find that there’s something different there. Thing is, while the above structure *does* allow us to find all added todo items, they will come in a random order (those UUIDs are random, after all).

One thing we can do is add a timestamp to the value and sort the items after we fetch them. But this hardly sounds like an efficient approach. Instead, what we *can* do is move the UUID to the value and append the key with some sort of unique and monotonically grown timestamp. A [Hybrid Logical Clock](http://pumpkindb.org/doc/script/HLC.html) is a good candidate for this. Now, one can quickly scan through all `AddedTodoItem`-prefixed key/value pairs and figure out what’s in the list, in what order and when exactly were the items added.

In PumpkinScript, this will be something like <code>"AddedTodoItem" [<a href="http://pumpkindb.org/doc/script/DUP.html">DUP</a> <a href="http://pumpkindb.org/doc/script/CURSOR/KEY.html">CURSOR/KEY</a> <a href="http://pumpkindb.org/doc/script/SWAP.html">SWAP</a> <a href="http://pumpkindb.org/doc/script/CURSOR/VAL.html">CURSOR/VAL</a> TRUE] <a href="http://pumpkindb.org/doc/script/CURSOR/DOWHILE-PREFIXED.html">CURSOR/DOWHILE-PREFIXED</a></code>. For every AddedTodoItem-prefixed key/value pair, extract the key and value.

```text title="todolist.txt"

                                                  Event-specific journals

                           +---------------+---------------+               +-------------+
                           |               |               |               |             |
                           | AddedTodoItem | HLC timestamp +--------------->     UUID    |
    Per-item journal       |               |               |               |             |
                           ++--------------+---------------+               +-------------+
+------+---------------+    ^                   +------------------------------^
|      |               |    |                   ^
| UUID | HLC timestamp +---+^-------------------|-----+---------------+    +-------------+
|      |               |   |                   ||     |               |    |             |
| UUID | HLC timestamp +---> ChangedTodoItem   ||UUID | HLC timestamp +----> Item's name |
|      |               |   |                   ||     |               |    |             |
| UUID | HLC timestamp +---+v-------------------------+---------------+    +-------------+
|      |               |    |                   |
+------+---------------+   +v------------------++-----+---------------+    +-------------+
                           |                   |      |               |    |             |
                           | ChangedItemStatus | UUID | HLC timestamp +----> True/False  |
                           |                   |      |               |    |             |
                           +-------------------+------+---------------+    +-------------+
```

Very similarly, we can design the layout for changing item’s description and status (`ChangedTodoItem` and `ChangedItemStatus`). The main difference in key composition here is that here we use three elements (prefix, item *UUID* reference, and a timestamp) instead of two.

Now, even though we’re able to sort through individual event types, if we want to see an aggregated list of events per item, that’ll again be rather inefficient as we would need to fetch all events with a certain UUID referenced in the key and then merge-sort all of them by the timestamp. What we can do instead is introduce another key space. Keys starting with a UUID should be appended with a timestamp and the value should be a key of a specific event. In PumpkinScript, retrieving from this list is still pretty trivial: <code>uuid [<a href="http://pumpkindb.org/doc/script/DUP.html">DUP</a> <a href="http://pumpkindb.org/doc/script/CURSOR/KEY.html">CURSOR/KEY</a> <a href="http://pumpkindb.org/doc/script/SWAP.html">SWAP</a> <a href="http://pumpkindb.org/doc/script/CURSOR/VAL.html">CURSOR/VAL</a> <a href="http://pumpkindb.org/doc/script/DUP.html">DUP</a> <a href="http://pumpkindb.org/doc/script/RETR.html">RETR</a> TRUE] <a href="http://pumpkindb.org/doc/script/CURSOR/DOWHILE-PREFIXED.html">CURSOR/DOWHILE-PREFIXED</a></code>.

As you can see, using this approach, we can actually tell what is going on — how much of a key space are we iterating through, how much data we’re duplicating, and so on. Of course, we’re not exposed to the mechanics of disks, memory paging or \[NVMe\] controller access at this level. For most of applications, that level of abstraction would indeed be too much. However, arguably, the B+-tree level is simple enough to work with and yet tells us a lot more about *how things work* and just how much complexity would be involved.

If you’re interested in exploring these and similar ideas, I will be happy if you check out [PumpkinDB](https://github.com/PumpkinDB/PumpkinDB#readme) project. We’re also hanging out on [Gitter](https://gitter.im/PumpkinDB/Lobby) and are not opposed to answering questions!
