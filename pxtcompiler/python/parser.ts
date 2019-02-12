namespace pxt.py {
    let inParens = false
    let tokens: Token[]
    let source: string
    let nextToken: number
    let currComments: Token[]
    let indentStack: number[]
    let prevToken: Token

    const eof: Token = fakeToken(TokenType.EOF, "EOF")

    type Parse = () => AST

    function fakeToken(tp: TokenType, val: string): Token {
        return {
            type: tp,
            value: val,
            startPos: 0,
            endPos: 0
        }
    }

    function peekToken() {
        return tokens[nextToken] || eof
    }

    function skipTokens() {
        for (; tokens[nextToken]; nextToken++) {
            let t = tokens[nextToken]
            if (t.type == TokenType.Comment) {
                currComments.push(t)
                continue
            }

            if (t.type == TokenType.Error)
                error(t.value)

            if (inParens) {
                if (t.type == TokenType.NewLine || t.type == TokenType.Indent)
                    continue
            } else {
                if (t.type == TokenType.Indent) {
                    let curr = parseInt(t.value)
                    let top = indentStack[indentStack.length - 1]
                    if (curr == top)
                        continue
                    else if (curr > top) {
                        indentStack.push(curr)
                        return
                    } else {
                        t.type = TokenType.Dedent
                        while (indentStack.length) {
                            let top = indentStack[indentStack.length - 1]
                            if (top > curr)
                                indentStack.pop()
                            else if (top == curr)
                                return
                            else {
                                error(U.lf("inconsitent indentation"))
                                return
                            }
                        }
                    }
                }
                return
            }
        }
    }

    function shiftToken() {
        prevToken = peekToken()
        nextToken++
        skipTokens()
    }

    function error(msg: string) {
        U.userError(U.lf("Python parse error: {0} near {1}", msg, tokenToString(peekToken())))
    }

    function expect(tp: TokenType, val: string) {
        let t = peekToken()
        if (t.type != tp || t.value != val) {
            error(U.lf("expecting {0}", tokenToString(fakeToken(tp, val))))
        } else {
            shiftToken()
        }
    }

    function expectNewline() {
        expect(TokenType.NewLine, "")
    }

    function expectKw(kw: string) {
        expect(TokenType.Keyword, kw)
    }

    function expectOp(op: string) {
        expect(TokenType.Op, op)
    }

    function currentKw() {
        let t = peekToken()
        if (t.type == TokenType.Keyword)
            return t.value
        return ""
    }

    function currentOp() {
        let t = peekToken()
        if (t.type == TokenType.Op)
            return t.value
        return ""
    }

    const compound_stmt_map: Map<() => Stmt> = {
        "if": if_stmt,
        "while": while_stmt,
        "for": for_stmt,
        "try": try_stmt,
        "with": with_stmt,
        "def": funcdef,
        "class": classdef,
    }

    const small_stmt_map: Map<() => Stmt> = {
        "del": del_stmt,
        "pass": pass_stmt,
        "break": break_stmt,
        "continue": continue_stmt,
        "return": return_stmt,
        "raise": raise_stmt,
        "global": global_stmt,
        "nonlocal": nonlocal_stmt,
        "import": import_stmt,
        "assert": assert_stmt,
    }

    function notSupported() {
        U.userError(U.lf("not supported yet"))
    }

    function colon_suite(): Stmt[] {
        expectOp("Colon")
        return suite()
    }

    function suite(): Stmt[] {
        throw notSupported()
    }

    function mkAST(kind: string, beg?: Token): AST {
        let t = beg || peekToken()
        return {
            startPos: t.startPos,
            endPos: t.endPos,
            lineno: null,
            col_offset: null,
            kind
        }
    }

    function finish<T extends AST>(v: T): T {
        v.endPos = prevToken.endPos
        return v
    }

    function orelse() {
        if (currentKw() == "else") {
            shiftToken()
            return colon_suite()
        }
        return []
    }

    function while_stmt() {
        let r = mkAST("While") as While
        expectKw("while")
        r.test = test()
        r.body = colon_suite()
        r.orelse = orelse()
        return finish(r)
    }

    function if_stmt(): Stmt { throw notSupported() }
    function for_stmt(): Stmt { throw notSupported() }
    function try_stmt(): Stmt { throw notSupported() }
    function with_stmt(): Stmt { throw notSupported() }
    function funcdef(): Stmt { throw notSupported() }
    function classdef(): Stmt { throw notSupported() }

    function del_stmt(): Stmt { throw notSupported() }
    function pass_stmt(): Stmt {
        let r = mkAST("Pass") as Pass
        expectKw("pass")
        return finish(r)
    }
    function break_stmt(): Stmt { throw notSupported() }
    function continue_stmt(): Stmt { throw notSupported() }
    function return_stmt(): Stmt { throw notSupported() }
    function raise_stmt(): Stmt { throw notSupported() }
    function global_stmt(): Stmt { throw notSupported() }
    function nonlocal_stmt(): Stmt { throw notSupported() }
    function import_stmt(): Stmt { throw notSupported() }
    function assert_stmt(): Stmt { throw notSupported() }

    function expr_stmt(): Stmt { throw notSupported() }

    function small_stmt() {
        let fn = U.lookup(small_stmt_map, currentKw())
        if (fn) return fn()
        else return expr_stmt()
    }
    function simple_stmt() {
        let res = [small_stmt()]
        while (currentOp() == "Semicolon") {
            shiftToken()
            if (peekToken().type == TokenType.NewLine)
                break
            res.push(small_stmt())
        }
        expectNewline()
        return res
    }

    function stmt(): Stmt[] {
        let fn = U.lookup(compound_stmt_map, currentKw())
        if (fn) return [fn()]
        else return simple_stmt()
    }

    function lambdef(): Expr {
        throw notSupported()
    }


    function test(): Expr {
        if (currentKw() == "lambda")
            return lambdef()

        let t0 = peekToken()
        let t = or_test()
        if (currentKw() == "if") {
            let r = mkAST("IfExp", t0) as IfExp
            r.body = t
            expectKw("if")
            r.test = or_test()
            expectKw("else")
            r.orelse = test()
            return finish(r)
        }

        return t
    }


    function bool_test(op: string, f: () => Expr): Expr {
        let t0 = peekToken()
        let r = f()
        if (currentKw() == op) {
            let r = mkAST("BoolOp", t0) as BoolOp
            r.op = op == "or" ? "Or" : "And"
            r.values = [r]
            while (currentKw() == op) {
                expectKw(op)
                r.values.push(f())
            }
            return finish(r)
        }
        return r
    }

    function and_test(): Expr {
        return bool_test("and", not_test)
    }

    function or_test(): Expr {
        return bool_test("or", and_test)
    }


    function not_test(): Expr {
        if (currentKw() == "not") {
            let r = mkAST("UnaryOp") as UnaryOp
            shiftToken()
            r.op = "Not"
            r.operand = not_test()
            return finish(r)
        } else
            return comparison()
    }


    const cmpOpMap: Map<cmpop> = {
        '<': "Lt",
        '>': "Gt",
        '==': "Eq",
        '>=': "GtE",
        '<=': "LtE",
        '!=': "NotEq",
        'in': "In",
        'not': "NotIn",
        'is': "Is",
    }

    function currentCmpOp() {
        return cmpOpMap[currentOp()] || cmpOpMap[currentKw()] || null
    }

    function comparison(): Expr {
        let t0 = peekToken()
        let e = expr()

        if (!currentCmpOp())
            return e

        let r = mkAST("Compare", t0) as Compare
        r.left = e
        r.comparators = []
        r.ops = []

        while (true) {
            let c = currentCmpOp()
            if (!c)
                break
            shiftToken();
            if (c == "NotIn")
                expectKw("in")
            else if (c == "Is") {
                if (currentKw() == "not") {
                    shiftToken()
                    c = "IsNot"
                }
            }
            r.ops.push(c)
            r.comparators.push(expr())
        }

        return finish(r)
    }

    const binOpMap: Map<operator> = {
        '+': "Add",
        '-': "Sub",
        '*': "Mult",
        '@': "MatMult",
        '/': "Div",
        '%': "Mod",
        '**': "Pow",
        '<<': "LShift",
        '>>': "RShift",
        '|': "BitOr",
        '^': "BitXor",
        '&': "BitAnd",
        '//': "FloorDiv",
    }

    const unOpMap: Map<unaryop> = {
        '~': "Invert",
        '-': "USub",
        '+': "UAdd",
    }

    function binOp(f: () => Expr, ops: string): Expr {
        let t0 = peekToken()
        let e = f()
        let o = currentOp()
        if (o && ops.indexOf("," + o + ",") >= 0) {
            let r = mkAST("BinOp", t0) as BinOp
            r.left = e
            r.op = binOpMap[o]
            r.right = binOp(f, ops)
            return r
        } else {
            return e
        }
    }

    function term() { return binOp(factor, ",*,@,/,%,//,") }
    function arith_expr() { return binOp(term, ",+,-,") }
    function shift_expr() { return binOp(arith_expr, ",<<,>>,") }
    function and_expr() { return binOp(shift_expr, ",&,") }
    function xor_expr() { return binOp(and_expr, ",^,") }
    function expr() { return binOp(xor_expr, ",|,") }


    /*
atom: ('(' [yield_expr|testlist_comp] ')' |
       '[' [testlist_comp] ']' |
       '{' [dictorsetmaker] '}' |
       NAME | NUMBER | STRING+ | '...' | 'None' | 'True' | 'False')

       sync_comp_for: 'for' exprlist 'in' or_test [comp_iter]

       */


    function subscript(): AnySlice {
        let t0 = peekToken()
        let lower: Expr = null
        if (currentOp() != ":") {
            lower = test()
        }
        if (currentOp() == ":") {
            let r = mkAST("Slice", t0) as Slice
            r.lower = lower
            shiftToken()
            let o = currentOp()
            if (o != ":" && o != "," && o != "]")
                r.upper = test()
            if (currentOp() == ":") {
                shiftToken()
                o = currentOp()
                if (o != "," && o != "]")
                    r.step = test()
            }
            return finish(r)
        } else {
            let r = mkAST("Index") as Index
            r.value = lower
            return finish(r)
        }
    }

    function star_or_test() {
        if (currentOp() == "*") {
            let r = mkAST("Starred") as Starred
            r.value = expr()
            return finish(r)
        } else {
            return test()
        }
    }

    function for_comp(): Comprehension[] {
        throw notSupported()
    }

    function argument(): Expr | Keyword {
        let t0 = peekToken()
        if (currentKw() == "*") {
            let r = mkAST("Starred") as Starred
            shiftToken()
            r.value = test()
            return finish(r)
        }
        if (currentKw() == "**") {
            let r = mkAST("Keyword") as Keyword
            shiftToken()
            r.arg = null
            r.value = test()
            return finish(r)
        }

        let e = test()
        if (currentOp() == "=") {
            if (e.kind != "Name")
                error(U.lf("invalid keyword argument; did you mean ==?"))
            shiftToken()
            let r = mkAST("Keyword", t0) as Keyword
            r.arg = (e as Name).id
            r.value = test()
            return finish(r)
        } else if (currentKw() == "for") {
            let r = mkAST("GeneratorExp", t0) as GeneratorExp
            r.elt = e
            r.generators = for_comp()
            return finish(r)
        } else {
            return e
        }
    }

    function atom(): Expr {
        let t = peekToken()

        if (t.type == TokenType.Id) {
            let r = mkAST("Name") as Name
            shiftToken()
            r.id = t.value
            return finish(r)
        } else if (t.type == TokenType.Number) {
            let r = mkAST("Num") as Num
            shiftToken()
            r.s = t.value
            r.n = parseFloat(r.s)
            return finish(r)
        } else if (t.type == TokenType.String) {
            let r = mkAST("Str") as Str
            shiftToken()
            r.s = t.value
            while (peekToken().type == TokenType.String) {
                r.s += peekToken().value
                shiftToken()
            }
            return finish(r)
        } else if (t.type == TokenType.Keyword) {
            if (t.value == "None" || t.value == "True" || t.value == "False") {
                let r = mkAST("NameConstant") as NameConstant
                shiftToken()
                r.value = t.value == "True" ? true : t.value == "False" ? false : null
                return finish(r)
            } else {
                error(U.lf("expecting atom"))
            }
        } else if (t.type == TokenType.Op) {
            let o = t.value
            if (o == "(") {
                return parseParens(")", "Tuple", "GeneratorExp")
            } else if (o == "[") {
                return parseParens("]", "List", "ListComp")
            } else if (o == "{") {
                throw notSupported()
            } else {
                error(U.lf("unexpected operator"))
            }
        } else {
            error(U.lf("unexpected token"))
        }

        throw notSupported()
    }

    function parseList<T>(
        cl: string,
        category: string,
        f: () => T,
    ): T[] {
        let r: T[] = []

        if (currentOp() == cl)
            return r
        for (; ;) {
            r.push(f())

            if (currentOp() == ",")
                shiftToken()

            // final comma is allowed, so no "else if" here
            if (currentOp() == cl) {
                shiftToken()
                return r
            } else {
                error(U.lf("expecting {0}", category))
            }
        }
    }

    function parseParenthesizedList<T>(
        cl: string,
        category: string,
        f: () => T
    ): T[] {
        inParens = true
        try {
            shiftToken()
            return parseList(cl, category, f)
        } finally {
            inParens = false
        }
    }

    function parseParens(cl: string, tuple: string, comp: string): Expr {
        inParens = true
        try {
            let t0 = peekToken()
            shiftToken()
            if (currentOp() == cl) {
                shiftToken()
                let r = mkAST(tuple) as Tuple
                r.elts = []
                return finish(r)
            }

            let e0 = star_or_test()
            if (currentKw() == "for") {
                let r = mkAST(comp) as GeneratorExp
                r.elt = e0
                r.generators = for_comp()
                return finish(r)
            }

            if (currentOp() == ",") {
                let r = mkAST(tuple) as Tuple
                r.elts = parseList(cl, U.lf("expression"), star_or_test)
                r.elts.unshift(e0)

                return finish(r)
            }

            if (currentOp() == cl) {
                shiftToken()
                return e0
            }

            error(U.lf("expecting expression"))
            return e0
        } finally {
            inParens = false
        }
    }

    function atom_expr(): Expr {
        let t0 = peekToken()
        let e = atom()
        let o = currentOp()
        if (o == "(") {
            let r = mkAST("Call", t0) as Call
            r.func = e
            let args = parseParenthesizedList(")", U.lf("argument"), argument)
            r.args = []
            r.keywords = []
            for (let e of args) {
                if (e.kind == "Keyword")
                    r.keywords.push(e as Keyword)
                else {
                    if (r.keywords.length)
                        error(U.lf("positional argument follows keyword argument"))
                    r.args.push(e as Expr)
                }
            }
            return finish(r)
        } else if (o == "[") {
            let t1 = peekToken()
            let r = mkAST("Subscript", t0) as Subscript
            r.value = e
            let sl = parseParenthesizedList("]", U.lf("subscript"), subscript)
            if (sl.length == 0)
                error(U.lf("need non-empty index list"))
            else if (sl.length == 1)
                r.slice = sl[0]
            else {
                let extSl = mkAST("ExtSlice", t1) as ExtSlice
                extSl.dims = sl
                r.slice = finish(extSl)
            }
            return finish(r)
        } else if (o == ".") {
            let r = mkAST("Attribute", t0) as Attribute
            r.value = e
            shiftToken()
            let t = peekToken()
            if (t.type != TokenType.Id)
                error(U.lf("expecting attribute name"))
            r.attr = t.value
            shiftToken()
            return finish(r)
        } else {
            return e

        }
    }

    function power(): Expr {
        let t0 = peekToken()
        let e = atom_expr()
        if (currentOp() == "**") {
            let r = mkAST("BinOp") as BinOp
            shiftToken()
            r.left = e
            r.op = "Pow"
            r.right = factor()
            return finish(r)
        } else {
            return e
        }
    }

    function factor(): Expr {
        if (unOpMap[currentOp()]) {
            let r = mkAST("UnaryOp") as UnaryOp
            r.op = unOpMap[currentOp()]
            r.operand = factor()
            return finish(r)
        } else {
            return power()
        }
    }


    export function parse(_source: string, _tokens: Token[]) {
        source = _source
        tokens = _tokens
        inParens = false
        nextToken = 0
        currComments = []
        indentStack = [0]

        prevToken = tokens[0]
        skipTokens()

        let res = stmt()
        while (peekToken().type != TokenType.EOF)
            U.pushRange(res, stmt())

        return res
    }
}

/*
# Grammar for Python

# NOTE WELL: You should also follow all the steps listed at
# https://devguide.python.org/grammar/

# Start symbols for the grammar:
#       single_input is a single interactive statement;
#       file_input is a module or sequence of commands read from an input file;
#       eval_input is the input for the eval() functions.
# NB: compound_stmt in single_input is followed by extra NEWLINE!
single_input: NEWLINE | simple_stmt | compound_stmt NEWLINE
file_input: (NEWLINE | stmt)* ENDMARKER
eval_input: testlist NEWLINE* ENDMARKER

decorator: '@' dotted_name [ '(' [arglist] ')' ] NEWLINE
decorators: decorator+
decorated: decorators (classdef | funcdef | async_funcdef)

async_funcdef: 'async' funcdef
funcdef: 'def' NAME parameters ['->' test] ':' suite

parameters: '(' [typedargslist] ')'
typedargslist: (tfpdef ['=' test] (',' tfpdef ['=' test])* [',' [
        '*' [tfpdef] (',' tfpdef ['=' test])* [',' ['**' tfpdef [',']]]
      | '**' tfpdef [',']]]
  | '*' [tfpdef] (',' tfpdef ['=' test])* [',' ['**' tfpdef [',']]]
  | '**' tfpdef [','])
tfpdef: NAME [':' test]
varargslist: (vfpdef ['=' test] (',' vfpdef ['=' test])* [',' [
        '*' [vfpdef] (',' vfpdef ['=' test])* [',' ['**' vfpdef [',']]]
      | '**' vfpdef [',']]]
  | '*' [vfpdef] (',' vfpdef ['=' test])* [',' ['**' vfpdef [',']]]
  | '**' vfpdef [',']
)
vfpdef: NAME

stmt: simple_stmt | compound_stmt
simple_stmt: small_stmt (';' small_stmt)* [';'] NEWLINE
small_stmt: (expr_stmt | del_stmt | pass_stmt | flow_stmt |
             import_stmt | global_stmt | nonlocal_stmt | assert_stmt)
expr_stmt: testlist_star_expr (annassign | augassign (yield_expr|testlist) |
                     ('=' (yield_expr|testlist_star_expr))*)
annassign: ':' test ['=' test]
testlist_star_expr: (test|star_expr) (',' (test|star_expr))* [',']
augassign: ('+=' | '-=' | '*=' | '@=' | '/=' | '%=' | '&=' | '|=' | '^=' |
            '<<=' | '>>=' | '**=' | '//=')
# For normal and annotated assignments, additional restrictions enforced by the interpreter
del_stmt: 'del' exprlist
pass_stmt: 'pass'
flow_stmt: break_stmt | continue_stmt | return_stmt | raise_stmt | yield_stmt
break_stmt: 'break'
continue_stmt: 'continue'
return_stmt: 'return' [testlist]
yield_stmt: yield_expr
raise_stmt: 'raise' [test ['from' test]]
import_stmt: import_name | import_from
import_name: 'import' dotted_as_names
# note below: the ('.' | '...') is necessary because '...' is tokenized as ELLIPSIS
import_from: ('from' (('.' | '...')* dotted_name | ('.' | '...')+)
              'import' ('*' | '(' import_as_names ')' | import_as_names))
import_as_name: NAME ['as' NAME]
dotted_as_name: dotted_name ['as' NAME]
import_as_names: import_as_name (',' import_as_name)* [',']
dotted_as_names: dotted_as_name (',' dotted_as_name)*
dotted_name: NAME ('.' NAME)*
global_stmt: 'global' NAME (',' NAME)*
nonlocal_stmt: 'nonlocal' NAME (',' NAME)*
assert_stmt: 'assert' test [',' test]

compound_stmt: if_stmt | while_stmt | for_stmt | try_stmt | with_stmt | funcdef | classdef | decorated | async_stmt
async_stmt: 'async' (funcdef | with_stmt | for_stmt)
if_stmt: 'if' test ':' suite ('elif' test ':' suite)* ['else' ':' suite]
while_stmt: 'while' test ':' suite ['else' ':' suite]
for_stmt: 'for' exprlist 'in' testlist ':' suite ['else' ':' suite]
try_stmt: ('try' ':' suite
           ((except_clause ':' suite)+
            ['else' ':' suite]
            ['finally' ':' suite] |
           'finally' ':' suite))
with_stmt: 'with' with_item (',' with_item)*  ':' suite
with_item: test ['as' expr]
# NB compile.c makes sure that the default except clause is last
except_clause: 'except' [test ['as' NAME]]
suite: simple_stmt | NEWLINE INDENT stmt+ DEDENT

test: or_test ['if' or_test 'else' test] | lambdef
test_nocond: or_test | lambdef_nocond
lambdef: 'lambda' [varargslist] ':' test
lambdef_nocond: 'lambda' [varargslist] ':' test_nocond
or_test: and_test ('or' and_test)*
and_test: not_test ('and' not_test)*
not_test: 'not' not_test | comparison
comparison: expr (comp_op expr)*
# <> isn't actually a valid comparison operator in Python. It's here for the
# sake of a __future__ import described in PEP 401 (which really works :-)
comp_op: '<'|'>'|'=='|'>='|'<='|'<>'|'!='|'in'|'not' 'in'|'is'|'is' 'not'
star_expr: '*' expr
expr: xor_expr ('|' xor_expr)*
xor_expr: and_expr ('^' and_expr)*
and_expr: shift_expr ('&' shift_expr)*
shift_expr: arith_expr (('<<'|'>>') arith_expr)*
arith_expr: term (('+'|'-') term)*
term: factor (('*'|'@'|'/'|'%'|'//') factor)*
factor: ('+'|'-'|'~') factor | power
power: atom_expr ['**' factor]
atom_expr: ['await'] atom trailer*
atom: ('(' [yield_expr|testlist_comp] ')' |
       '[' [testlist_comp] ']' |
       '{' [dictorsetmaker] '}' |
       NAME | NUMBER | STRING+ | '...' | 'None' | 'True' | 'False')
testlist_comp: (test|star_expr) ( comp_for | (',' (test|star_expr))* [','] )
trailer: '(' [arglist] ')' | '[' subscriptlist ']' | '.' NAME
subscriptlist: subscript (',' subscript)* [',']
subscript: test | [test] ':' [test] [sliceop]
sliceop: ':' [test]
exprlist: (expr|star_expr) (',' (expr|star_expr))* [',']
testlist: test (',' test)* [',']
dictorsetmaker: ( ((test ':' test | '**' expr)
                   (comp_for | (',' (test ':' test | '**' expr))* [','])) |
                  ((test | star_expr)
                   (comp_for | (',' (test | star_expr))* [','])) )

classdef: 'class' NAME ['(' [arglist] ')'] ':' suite

arglist: argument (',' argument)*  [',']

# The reason that keywords are test nodes instead of NAME is that using NAME
# results in an ambiguity. ast.c makes sure it's a NAME.
# "test '=' test" is really "keyword '=' test", but we have no such token.
# These need to be in a single rule to avoid grammar that is ambiguous
# to our LL(1) parser. Even though 'test' includes '*expr' in star_expr,
# we explicitly match '*' here, too, to give it proper precedence.
# Illegal combinations and orderings are blocked in ast.c:
# multiple (test comp_for) arguments are blocked; keyword unpackings
# that precede iterable unpackings are blocked; etc.
argument: ( test [comp_for] |
            test '=' test |
            '**' test |
            '*' test )

comp_iter: comp_for | comp_if
sync_comp_for: 'for' exprlist 'in' or_test [comp_iter]
comp_for: ['async'] sync_comp_for
comp_if: 'if' test_nocond [comp_iter]

# not used in grammar, but may appear in "node" passed from Parser to Compiler
encoding_decl: NAME

yield_expr: 'yield' [yield_arg]
yield_arg: 'from' test | testlist
*/
