import * as helpers from "@babel/helpers";
import generator from "@babel/generator";
import template from "@babel/template";
import * as t from "@babel/types";
import File from "../transformation/file/file";

// Wrapped to avoid wasting time parsing this when almost no-one uses
// build-external-helpers.
const buildUmdWrapper = replacements =>
  template.statement`
    (function (root, factory) {
      if (typeof define === "function" && define.amd) {
        define(AMD_ARGUMENTS, factory);
      } else if (typeof exports === "object") {
        factory(COMMON_ARGUMENTS);
      } else {
        factory(BROWSER_ARGUMENTS);
      }
    })(UMD_ROOT, function (FACTORY_PARAMETERS) {
      FACTORY_BODY
    });
  `(replacements);

function buildGlobal(allowlist?: Array<string>) {
  const namespace = t.identifier("babelHelpers");

  const body: t.Statement[] = [];
  const container = t.functionExpression(
    null,
    [t.identifier("global")],
    t.blockStatement(body),
  );
  const tree = t.program([
    t.expressionStatement(
      t.callExpression(container, [
        // typeof global === "undefined" ? self : global
        t.conditionalExpression(
          t.binaryExpression(
            "===",
            t.unaryExpression("typeof", t.identifier("global")),
            t.stringLiteral("undefined"),
          ),
          t.identifier("self"),
          t.identifier("global"),
        ),
      ]),
    ),
  ]);

  body.push(
    t.variableDeclaration("var", [
      t.variableDeclarator(
        namespace,
        t.assignmentExpression(
          "=",
          t.memberExpression(t.identifier("global"), namespace),
          t.objectExpression([]),
        ),
      ),
    ]),
  );

  buildHelpers(body, namespace, allowlist);

  return tree;
}

function buildModule(allowlist?: Array<string>) {
  const body: t.Statement[] = [];
  const refs = buildHelpers(body, null, allowlist);

  body.unshift(
    t.exportNamedDeclaration(
      null,
      Object.keys(refs).map(name => {
        return t.exportSpecifier(t.cloneNode(refs[name]), t.identifier(name));
      }),
    ),
  );

  return t.program(body, [], "module");
}

function buildUmd(allowlist?: Array<string>) {
  const namespace = t.identifier("babelHelpers");

  const body: t.Statement[] = [];
  body.push(
    t.variableDeclaration("var", [
      t.variableDeclarator(namespace, t.identifier("global")),
    ]),
  );

  buildHelpers(body, namespace, allowlist);

  return t.program([
    buildUmdWrapper({
      FACTORY_PARAMETERS: t.identifier("global"),
      BROWSER_ARGUMENTS: t.assignmentExpression(
        "=",
        t.memberExpression(t.identifier("root"), namespace),
        t.objectExpression([]),
      ),
      COMMON_ARGUMENTS: t.identifier("exports"),
      AMD_ARGUMENTS: t.arrayExpression([t.stringLiteral("exports")]),
      FACTORY_BODY: body,
      UMD_ROOT: t.identifier("this"),
    }),
  ]);
}

function buildVar(allowlist?: Array<string>) {
  const namespace = t.identifier("babelHelpers");

  const body: t.Statement[] = [];
  body.push(
    t.variableDeclaration("var", [
      t.variableDeclarator(namespace, t.objectExpression([])),
    ]),
  );
  const tree = t.program(body);
  buildHelpers(body, namespace, allowlist);
  body.push(t.expressionStatement(namespace));
  return tree;
}

function buildHelpers(
  body: t.Statement[],
  namespace: t.Expression | null,
  allowlist?: Array<string>,
) {
  const getHelperReference = (name: string) => {
    return namespace
      ? t.memberExpression(namespace, t.identifier(name))
      : t.identifier(`_${name}`);
  };

  const refs = {};
  helpers.list.forEach(function (name) {
    if (allowlist && allowlist.indexOf(name) < 0) return;

    const ref = (refs[name] = getHelperReference(name));

    helpers.ensure(name, File);
    const { nodes } = helpers.get(name, getHelperReference, ref);

    body.push(...nodes);
  });
  return refs;
}
export default function (
  allowlist?: Array<string>,
  outputType: "global" | "module" | "umd" | "var" = "global",
) {
  let tree: t.Program;

  const build = {
    global: buildGlobal,
    module: buildModule,
    umd: buildUmd,
    var: buildVar,
  }[outputType];

  if (build) {
    tree = build(allowlist);
  } else {
    throw new Error(`Unsupported output type ${outputType}`);
  }

  return generator(tree).code;
}
