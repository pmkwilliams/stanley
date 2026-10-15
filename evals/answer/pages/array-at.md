<!-- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at · 2026-10-15 · Array.prototype.at() - JavaScript | MDN -->
# Array.prototype.at()
[Baseline WIDELY AVAILABLE]
This feature is well established and works across many devices and browser versions. It’s been available across browsers since March 2022.
- See full compatibility
- Learn more
The at() method of Array instances takes an integer value and returns the item at that index, allowing for positive and negative integers. Negative integers count back from the last item in the array.
## In this article
- Try it
- Syntax
- Description
- Examples
- Specifications
- Browser compatibility
- See also
## Try it
## Syntax
### Parameters
index
Zero-based index of the array element to be returned, converted to an integer . Negative index counts back from the end of the array — if index < 0 , index + array.length is accessed.
### Return value
The element in the array matching the given index. Always returns undefined if index < -array.length or index >= array.length without attempting to access the corresponding property.
## Description
The at() method is equivalent to the bracket notation when index is a non-negative integer. For example, array[0] and array.at(0) both return the first item. However, when counting elements from the end of the array, you cannot use array[-1] like you may in Python or R, because all values inside the square brackets are treated literally as string properties, so you will end up reading array["-1"] , which is just a normal string property instead of an array index.
The usual practice is to access length and calculate the index from that — for example, array[array.length - 1] . The at() method allows relative indexing, so this can be shortened to array.at(-1) .
By combining at() with with() , you can both read and write (respectively) an array using negative indices.
The at() method is generic . It only expects the this value to have a length property and integer-keyed properties.
## Examples
### Return the last value of an array
The following example provides a function which returns the last element found in a specified array.
### Comparing methods
This example compares different ways to select the penultimate (last but one) item of an Array . While all the methods shown below are valid, this example highlights the succinctness and readability of the at() method.
### Calling at() on non-array objects
The at() method reads the length property of this and calculates the index to access.
## Specifications
Specification
Specification: ECMAScript® 2027 Language Specification # sec-array.prototype.at
## Browser compatibility
## See also
- Polyfill of Array.prototype.at in core-js
- es-shims polyfill of Array.prototype.at
- Indexed collections guide
- Array
- Array.prototype.findIndex()
- Array.prototype.indexOf()
- Array.prototype.with()
- TypedArray.prototype.at()
- String.prototype.at()
## Help improve MDN
Learn how to contribute
This page was last modified on Jul 20, 2025 by MDN contributors .
View this page on GitHub • Report a problem with this content
