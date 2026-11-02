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
