import Root from "./app.svelte";
import Bar from "./app-bar.svelte";
import Body from "./app-body.svelte";
import Group from "./app-group.svelte";
import Section from "./app-section.svelte";
import Split from "./app-split.svelte";
import Title from "./app-title.svelte";

export { appVariants, type AppSize } from "./app.svelte";

export {
	Root,
	Bar,
	Title,
	Body,
	Split,
	Section,
	Group,
	//
	Root as App,
	Bar as AppBar,
	Title as AppTitle,
	Body as AppBody,
	Split as AppSplit,
	Section as AppSection,
	Group as AppGroup,
};
