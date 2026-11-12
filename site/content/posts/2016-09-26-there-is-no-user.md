---
title: "There Is No “User”"
date: 2016-09-26
permalink: /blog/2016/09/26/there-is-no-user/
tags:
  - event sourcing
  - databases
excerpt: "We all have had some of our lightbulb moments happen at the wrong time. This one happened to me at the very beginning of a project, the time when you need to get stuff out of the door as quickly as possible to test the assumptions and hypotheses."
original: https://medium.com/eventsourcing-publications/there-is-no-user-acb7d367469f
originalVenue: Eventsourcing Publications on Medium
---
![](/blog/posts/there-is-no-user/1.jpg)

We all have had some of our *lightbulb moments* happen at the wrong time. This one happened to me at the very beginning of a project, the time when you need to get stuff out of the door as quickly as possible to test the assumptions and hypotheses.

I was building the most common, the most boring part of the application, namely minimalistic user authentication. My habitual way of doing this is to start with a third-party OAuth authentication scheme to delay doing the more tedious ones. This time it was LinkedIn (but could have been anything else) and the moment I got the access token back, I was about to declare some sort of “user” record that would be associated with the email address I got back from LinkedIn. Sounds familiar?

But then something stopped me. Lately, I’ve been trying to see and describe systems through concepts mapped to what has happened “in the real world” as closely as possible, as opposed to synthesizing concepts. So, instead of explaining this part as “here we’re creating a user and associating an access token to his LinkedIn account”, I went back and described this “somebody clicked the `Sign in with LinkedIn` button, and I know that person’s email address and can probably learn a bit more about them using LinkedIn API”.

![](/blog/posts/there-is-no-user/2.png)

I know it sounds a little silly (because, duh, that’s what happened, isn’t it obvious?) but I find that [recording actual facts versus substituting them with what we made of them](https://blog.eventsourcing.com/why-use-eventsourcing-database-6b5e2ac61848) is very rewarding in the longer term. The substitution is likely to introduce some loss or distortion of information along the way and there’s very little we can do to recover it.

So I just kept the record of what happened, but I needed to refer to this person’s unique identifier (independent of its identity attributes such as email address). Since I was developing using [Eventsourcing](https://eventsourcing.com) I was thinking how to describe the fact that the system learned that a person exists through an event. `LearnedAboutAPerson` was cute but too self-centered and error-prone. What if the system “knew” about this person in some way before? `PersonCreated` is a big no-no for proper event sourcing systems (persons are definitely not created when they attempt to log in!). Nothing seemed to fit quite right. But I still needed to refer to some event’s UUID to link the activity to it so I can later link it all together.

Because I couldn’t find any event I can refer to, the solution was to just generate a random UUID for a person, and attach whatever I learned about this person in subsequent events. And while doing this, I should use the information I know about this person to see if I’ve already known about it. This is how [RFC 10/LIBRE](https://rfc.eventsourcing.com/spec:10/LIBRE) was born. If you read through the example in 2.1. you will recognize the case I was talking about.

One of the interesting aspects of introducing something into existence by merely referencing it is that it allows you to decide just *what that was* later, if ever!

How does this work? In the above example, I basically have three resulting events, `AuthenticationTokenAcquired`, `NameChanged` and `EmailChanged`. They all refer to the same UUID, yet nothing anywhere defines just what that UUID is referring to. Was that a person? Was that a device doing all the clicking? Does it matter? Can we decide later?

Which gets me to the next point.

*User* is probably the most pervasive domain model in the industry, especially since the widespread adoption of the two-tier client-server model. This has been going on for decades. Nearly every project starts with it. A number of standards and frameworks have been designed to generalize the concept, with different degrees of universality.

Yet, what exactly does constitute a user?

In a “users” table you can often find things like name, password, e-mail, confirmation/reset tokens, two-factor authentication secret, last access information. Users can be often found associated with groups. Or roles. Or both.

So, it is an arbitrary set of attributes that cross several domains, such as authentication, identity, logging, membership, permissions.

On the other side, for example, in the context of Java security frameworks, a User is a Principal usually referring to a human operator. And a Principal is a Subject that is represented by an account, a role or some other identifier. And a Subject is something that is accessing an object.

On both sides of the spectrum, it is hard to define clearly and succinctly what a user actually is.

Because there is no such thing. A person or a program can log in and use the application. A user can’t, because “user” is really more of a role. Merriam-Webster defines “user” as a “person or thing that uses something”. Anything that connects to the application, automatically assumes this role.

But, if everybody and everything has this role, isn’t this an equivalent of not having it at all? To give you an example, if everybody had assumed the role of an administrator, would there actually be any administrators?

I will be talking about the concepts behind this in November 2016 at [O’Reilly Software Architecture in San Francisco](http://conferences.oreilly.com/software-architecture/engineering-business-ca/public/schedule/detail/52244). This will be the first time I will be presenting Lazy Event Sourcing in front of a larger audience.

If you can’t come, you’re always welcome at [Eventsourcing‘s Gitter](http://gitter.im/eventsourcing/eventsourcing) to create a useful distraction in a form of conversation!
