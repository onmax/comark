---
title: Edge cases
---

```md
::alert{type="nope"}
```

Inline code `:icon{name=1}`, an emoji :smile:, and a time 10:30 are not components.

::card{title="Nested"}
  :::alert{type="warning"}
  Inside
  :::

#footer
:icon{name="star" :size="16"}
::

::card
```yaml [props]
title: YAML props
tags: [a, b]
```
Body
::

::UButton{label="Pascal case"}
::

::alert{type="info" .wide #intro}
Classes and ids are not props.
::

::card {title="Spaces before props"}
::

::card{title="Inline"}
---
tags: [a, b]
---
::

::card

```yaml [props]
title: Props fence after a blank line
```
::

::card{title="JSON without a colon" tags=["a", "b"] .bg-[url('x=1')]}
#Footer
::

::card{title="first" title="Repeated, the last one wins"}
#footer more words make this prose, not a slot
::

:UButton{label="Shorthand"}

    :indented-code

`a code span
:over-lines`
