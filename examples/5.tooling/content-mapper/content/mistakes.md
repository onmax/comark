---
title: Mistakes
draft: "yes"
---

::alert{type="warn"}
`type` takes info, warning, or danger.
::

::alert
`type` is required.
::

::card{title="Typo in the name" colour="blue"}
#sidebar
Cards have no sidebar slot.
::

::callout{type="info"}
No component is registered as `callout`.
::

A count needs `:` to be a number: :badge{count="3"}

::alert{type="info" :title="frontmatter.subtitle"}
The frontmatter has no `subtitle`.
::
