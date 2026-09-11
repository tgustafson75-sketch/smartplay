/**
 * no-hardcoded-jsx-text — FAIL on a user-facing string literal that never reaches i18n.
 *
 * 2026-09-11 (release 1.5, Localization Layer) — THIS RULE EXISTS BECAUSE TWO CAMPAIGNS DECAYED.
 *
 * June 2026 translated "5 main tabs" (scorecard, dashboard, play, swinglab, settings) and stopped.
 * 1,871 commits later those were still the only five files in the app calling t(), out of 208, and
 * ~2,091 user-facing strings had been written in English in between. The 2026-05-26 audit had
 * already recorded the same number — "only 5 of ~50+ screens use useTranslation()" — so the gap was
 * known, written down, and grew anyway. Nothing was enforcing it. See docs/I18N-AUDIT.md.
 *
 * A translation campaign without a gate is a snapshot, not a state. This is the gate.
 *
 * WHAT IT FLAGS
 *   1. Text children of a text-rendering component — <Text>Start Round</Text>
 *   2. String values of user-facing props — title, label, placeholder, accessibilityLabel, …
 *   3. String arguments to Alert.alert / Toast.show and friends
 *
 * WHAT IT DOES NOT FLAG, and why the allowlist is explicit rather than per-file disables:
 * a `// eslint-disable` comment is invisible at review time and permanent by default, which is how
 * the last two campaigns rotted. So non-user-facing literals are named HERE, once, in `ignoredProps`
 * — testID, style keys, icon names, route hrefs — and anything not on that list is a violation by
 * construction. Adding a new non-user-facing prop is a deliberate edit to this file, visible in the
 * diff, rather than a disable comment buried in a screen.
 *
 * [[whats-new-is-part-of-shipping]] [[no-half-fixes-enforce-every-surface]]
 */
'use strict';

/** Components whose *children* are rendered to the player. */
const DEFAULT_TEXT_COMPONENTS = [
  'Text', 'RNText', 'ThemedText', 'AppText', 'Heading', 'Title', 'Subtitle',
  'Label', 'Paragraph', 'Caption', 'Chip', 'Badge', 'Button', 'Pressable.Text',
];

/** Props whose string value is rendered or spoken to the player. */
const DEFAULT_USER_FACING_PROPS = [
  'title', 'label', 'placeholder', 'message', 'subtitle', 'heading', 'caption',
  'accessibilityLabel', 'accessibilityHint', 'accessibilityValue',
  'header', 'footer', 'emptyText', 'errorText', 'helperText', 'text',
  'confirmLabel', 'cancelLabel', 'buttonText', 'ctaLabel', 'alt',
];

/**
 * Props that carry identifiers, not prose. These are the ONLY escape hatch — see header.
 * `name` covers icon names (<Ionicons name="golf" />), `source`/`href`/`uri` are locations,
 * `testID` and `nativeID` are hooks for tests, `key`/`id` are React/DOM identity.
 */
const DEFAULT_IGNORED_PROPS = [
  'testID', 'nativeID', 'key', 'id', 'name', 'icon', 'iconName', 'family',
  'style', 'className', 'variant', 'size', 'color', 'backgroundColor', 'tintColor',
  'href', 'uri', 'source', 'src', 'to', 'route', 'pathname', 'screen',
  'type', 'mode', 'kind', 'role', 'keyboardType', 'autoComplete', 'textContentType',
  'resizeMode', 'entering', 'exiting', 'sharedTransitionTag', 'collapsable',
  'accessibilityRole', 'importantForAccessibility', 'dataSet', 'format',
];

/** Call expressions whose string arguments are shown to the player. */
const DEFAULT_ALERT_CALLEES = [
  'Alert.alert', 'Toast.show', 'ToastAndroid.show', 'Alert.prompt', 'showToast', 'toast',
];

/**
 * A literal worth translating contains at least two letters in a row somewhere — which excludes
 * "·", "—", "%", "{{n}}", "1.5", "OK"… no: "OK" IS user-facing. Two letters is the floor because a
 * single letter is almost always an axis label or a unit, and prose is never one letter.
 */
function looksLikeProse(raw) {
  const s = String(raw).trim();
  if (s.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  // Pure identifiers — camelCase, snake_case, kebab-case, dotted paths, URLs — are not prose.
  if (/^[a-z0-9]+([A-Z][a-z0-9]*)*$/.test(s)) return false;      // camelCase / lowercase word
  if (/^[a-z0-9_]+$/i.test(s) && s.includes('_')) return false;   // snake_case
  if (/^[a-z0-9-]+$/i.test(s) && s.includes('-')) return false;   // kebab-case
  if (/^[\w.]+$/.test(s) && s.includes('.')) return false;        // dotted.path
  if (/^https?:\/\//.test(s)) return false;
  if (/^[#@/]/.test(s)) return false;                             // colors, handles, paths
  return true;
}

function calleeName(node) {
  const c = node.callee;
  if (!c) return '';
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && c.object && c.property) {
    const o = c.object.name ?? (c.object.type === 'MemberExpression' ? c.object.property?.name : '');
    return `${o ?? ''}.${c.property.name ?? ''}`;
  }
  return '';
}

function elementName(node) {
  const n = node.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name ?? ''}.${n.property?.name ?? ''}`;
  return '';
}

module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'User-facing strings must go through the translation function t().' },
    schema: [{
      type: 'object',
      properties: {
        textComponents: { type: 'array', items: { type: 'string' } },
        userFacingProps: { type: 'array', items: { type: 'string' } },
        ignoredProps: { type: 'array', items: { type: 'string' } },
        alertCallees: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    }],
    messages: {
      jsxText: 'Hardcoded user-facing text "{{text}}". Wrap it in t(\'…\') — a non-English player sees this in English. See docs/I18N-AUDIT.md.',
      jsxProp: 'Hardcoded user-facing string in prop `{{prop}}`: "{{text}}". Wrap it in t(\'…\').',
      alertArg: 'Hardcoded user-facing string passed to {{callee}}: "{{text}}". Wrap it in t(\'…\').',
    },
  },

  create(context) {
    const opt = context.options[0] ?? {};
    const textComponents = new Set(opt.textComponents ?? DEFAULT_TEXT_COMPONENTS);
    const userFacingProps = new Set(opt.userFacingProps ?? DEFAULT_USER_FACING_PROPS);
    const ignoredProps = new Set(opt.ignoredProps ?? DEFAULT_IGNORED_PROPS);
    const alertCallees = new Set(opt.alertCallees ?? DEFAULT_ALERT_CALLEES);

    const short = (s) => {
      const t = String(s).trim().replace(/\s+/g, ' ');
      return t.length > 48 ? `${t.slice(0, 45)}…` : t;
    };

    return {
      // 1. <Text>Start Round</Text>
      JSXText(node) {
        if (!looksLikeProse(node.value)) return;
        const parent = node.parent;
        if (!parent || parent.type !== 'JSXElement') return;
        const name = elementName(parent.openingElement);
        // Match `Text`, `MyText`, `Text.Bold` — anything whose final segment is a text component.
        const tail = name.split('.').pop() ?? name;
        if (!textComponents.has(tail) && !/Text$/.test(tail)) return;
        context.report({ node, messageId: 'jsxText', data: { text: short(node.value) } });
      },

      /**
       * 1b. <Text>{'Start Round'}</Text> — a string LITERAL inside an expression container.
       *
       * Caught by the fixture, not by design: the first version handled JSXText only, so wrapping a
       * literal in braces silently passed the gate. That is a one-character bypass of the whole
       * rule, and exactly the shape a codemod's partial output leaves behind.
       */
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (!parent || parent.type !== 'JSXElement') return;   // a child, not an attribute value
        const expr = node.expression;
        const parts = expr?.type === 'Literal' ? [expr]
          : expr?.type === 'TemplateLiteral' && expr.expressions.length === 0 ? expr.quasis
          : [];
        for (const part of parts) {
          const raw = part.type === 'TemplateElement' ? part.value?.cooked : part.value;
          if (typeof raw !== 'string' || !looksLikeProse(raw)) continue;
          const name = elementName(parent.openingElement);
          const tail = name.split('.').pop() ?? name;
          if (!textComponents.has(tail) && !/Text$/.test(tail)) continue;
          context.report({ node: part, messageId: 'jsxText', data: { text: short(raw) } });
        }
      },

      // 2. <Button title="Start Round" /> and accessibilityLabel="…"
      JSXAttribute(node) {
        const prop = node.name?.name;
        if (typeof prop !== 'string') return;
        if (ignoredProps.has(prop)) return;
        if (!userFacingProps.has(prop)) return;

        let value = null;
        if (node.value?.type === 'Literal' && typeof node.value.value === 'string') {
          value = node.value.value;
        } else if (
          node.value?.type === 'JSXExpressionContainer' &&
          node.value.expression?.type === 'Literal' &&
          typeof node.value.expression.value === 'string'
        ) {
          value = node.value.expression.value;
        }
        if (value == null || !looksLikeProse(value)) return;
        context.report({ node, messageId: 'jsxProp', data: { prop, text: short(value) } });
      },

      // 3. Alert.alert('Sim round failed', 'Try again')
      CallExpression(node) {
        const callee = calleeName(node);
        if (!alertCallees.has(callee)) return;
        for (const arg of node.arguments) {
          if (arg.type === 'Literal' && typeof arg.value === 'string' && looksLikeProse(arg.value)) {
            context.report({ node: arg, messageId: 'alertArg', data: { callee, text: short(arg.value) } });
          }
        }
      },
    };
  },
};
