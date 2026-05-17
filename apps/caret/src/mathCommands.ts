/**
 * KaTeX commands and their arity (number of braced arguments).
 *
 * Single source of truth — `KATEX_COMMAND_NAMES` and `arityOf` are derived.
 * Each entry includes the leading backslash so strings can be inserted
 * verbatim during autocomplete and rendered as-typed in the suggestion list.
 *
 * Arity conventions:
 *   - 0: bare command (Greek letters, big operators, relations, symbols,
 *     trig/log/lim function-names, all delimiter symbols).
 *   - 1: takes one `{...}` group (style wrappers, accents/decorations,
 *     `\sqrt`, `\begin`/`\end`).
 *   - 2: takes two `{...}` groups (fractions, binomials).
 *   - 3+: rare; `\fcolorbox` (3), `\mathchoice` (4), `\genfrac` (6).
 *
 * Notable 0-arity choices: `\left`, `\right`, `\big`, `\bigl`, `\Bigg`, etc.
 * take a delimiter character (not a braced group), so they're treated as
 * 0-arity; the user types the delimiter themselves. Same for the delimiter
 * symbols `\langle`/`\rangle`/`\lceil`/`\lfloor`/etc. `\sqrt` has an
 * optional `[n]` index in addition to its required arg; we only emit the
 * required `{}`. Stretchy arrows like `\xrightarrow` also have an optional
 * below-arg that we ignore.
 *
 * Derived by scanning `KaTeX-main/src/functions/*.ts` (defineFunction),
 * `src/symbols.ts` (defineSymbol), and `src/macros.ts` (defineMacro).
 * Internal `@`-prefixed commands and non-alphabetic single-char commands
 * (`\\`, `\(`, `\)`, `\]`, `\,`, `\;`, `\:`, `\!`) are intentionally omitted.
 * Adding to the map is just a `"\\name": N,` line.
 */
export const KATEX_COMMANDS: Readonly<Record<string, number>> = {
    // Greek lowercase
    "\\alpha": 0, "\\beta": 0, "\\gamma": 0, "\\delta": 0, "\\epsilon": 0,
    "\\varepsilon": 0, "\\zeta": 0, "\\eta": 0, "\\theta": 0, "\\vartheta": 0,
    "\\iota": 0, "\\kappa": 0, "\\lambda": 0, "\\mu": 0, "\\nu": 0, "\\xi": 0,
    "\\pi": 0, "\\varpi": 0, "\\rho": 0, "\\varrho": 0, "\\sigma": 0,
    "\\varsigma": 0, "\\tau": 0, "\\upsilon": 0, "\\phi": 0, "\\varphi": 0,
    "\\chi": 0, "\\psi": 0, "\\omega": 0, "\\digamma": 0,

    // Greek uppercase
    "\\Gamma": 0, "\\Delta": 0, "\\Theta": 0, "\\Lambda": 0, "\\Xi": 0,
    "\\Pi": 0, "\\Sigma": 0, "\\Upsilon": 0, "\\Phi": 0, "\\Psi": 0,
    "\\Omega": 0,

    // Greek uppercase italic (AMS var-capitals)
    "\\varGamma": 0, "\\varDelta": 0, "\\varTheta": 0, "\\varLambda": 0,
    "\\varXi": 0, "\\varPi": 0, "\\varSigma": 0, "\\varUpsilon": 0,
    "\\varPhi": 0, "\\varPsi": 0, "\\varOmega": 0,

    // Greek uppercase Latin-letter aliases
    "\\Alpha": 0, "\\Beta": 0, "\\Chi": 0, "\\Epsilon": 0, "\\Eta": 0,
    "\\Iota": 0, "\\Kappa": 0, "\\Mu": 0, "\\Nu": 0, "\\Omicron": 0,
    "\\Rho": 0, "\\Tau": 0, "\\Zeta": 0,

    // Big operators
    "\\sum": 0, "\\prod": 0, "\\coprod": 0, "\\int": 0, "\\iint": 0,
    "\\iiint": 0, "\\oint": 0, "\\oiint": 0, "\\oiiint": 0,
    "\\bigcup": 0, "\\bigcap": 0, "\\bigoplus": 0, "\\bigotimes": 0,
    "\\bigodot": 0, "\\bigvee": 0, "\\bigwedge": 0, "\\bigsqcup": 0,
    "\\biguplus": 0, "\\smallint": 0, "\\intop": 0,

    // Relations
    "\\leq": 0, "\\geq": 0, "\\neq": 0, "\\le": 0, "\\ge": 0, "\\ne": 0,
    "\\lt": 0, "\\gt": 0, "\\approx": 0, "\\sim": 0, "\\simeq": 0,
    "\\equiv": 0, "\\cong": 0, "\\propto": 0, "\\ll": 0, "\\gg": 0,
    "\\prec": 0, "\\succ": 0, "\\preceq": 0, "\\succeq": 0,
    "\\perp": 0, "\\parallel": 0, "\\mid": 0,
    "\\leqq": 0, "\\geqq": 0, "\\leqslant": 0, "\\geqslant": 0,
    "\\nleq": 0, "\\ngeq": 0, "\\nleqq": 0, "\\ngeqq": 0,
    "\\nleqslant": 0, "\\ngeqslant": 0,
    "\\lneq": 0, "\\gneq": 0, "\\lneqq": 0, "\\gneqq": 0,
    "\\lnapprox": 0, "\\gnapprox": 0, "\\lnsim": 0, "\\gnsim": 0,
    "\\lvertneqq": 0, "\\gvertneqq": 0,
    "\\lessdot": 0, "\\gtrdot": 0, "\\lessgtr": 0, "\\gtrless": 0,
    "\\lesseqgtr": 0, "\\gtreqless": 0, "\\lesseqqgtr": 0, "\\gtreqqless": 0,
    "\\lessapprox": 0, "\\gtrapprox": 0, "\\lesssim": 0, "\\gtrsim": 0,
    "\\lll": 0, "\\llless": 0, "\\ggg": 0, "\\gggtr": 0,
    "\\approxeq": 0, "\\asymp": 0, "\\backsim": 0, "\\backsimeq": 0,
    "\\between": 0, "\\bowtie": 0, "\\bumpeq": 0, "\\Bumpeq": 0,
    "\\circeq": 0, "\\doteq": 0, "\\Doteq": 0, "\\doteqdot": 0,
    "\\eqcirc": 0, "\\eqsim": 0, "\\eqslantgtr": 0, "\\eqslantless": 0,
    "\\fallingdotseq": 0, "\\risingdotseq": 0,
    "\\frown": 0, "\\smile": 0, "\\smallfrown": 0, "\\smallsmile": 0,
    "\\models": 0, "\\ncong": 0, "\\nsim": 0,
    "\\nmid": 0, "\\nparallel": 0,
    "\\shortmid": 0, "\\shortparallel": 0,
    "\\nshortmid": 0, "\\nshortparallel": 0,
    "\\pitchfork": 0,
    "\\precapprox": 0, "\\preccurlyeq": 0,
    "\\precnapprox": 0, "\\precneqq": 0, "\\precnsim": 0, "\\precsim": 0,
    "\\nprec": 0, "\\npreceq": 0,
    "\\succapprox": 0, "\\succcurlyeq": 0,
    "\\succnapprox": 0, "\\succneqq": 0, "\\succnsim": 0, "\\succsim": 0,
    "\\nsucc": 0, "\\nsucceq": 0,
    "\\nless": 0, "\\ngtr": 0,
    "\\thickapprox": 0, "\\thicksim": 0,
    "\\triangleq": 0, "\\trianglelefteq": 0, "\\trianglerighteq": 0,
    "\\ntriangleleft": 0, "\\ntriangleright": 0,
    "\\ntrianglelefteq": 0, "\\ntrianglerighteq": 0,
    "\\vartriangleleft": 0, "\\vartriangleright": 0,
    "\\vdash": 0, "\\vDash": 0, "\\Vdash": 0, "\\VDash": 0, "\\Vvdash": 0,
    "\\nvdash": 0, "\\nvDash": 0, "\\nVdash": 0, "\\nVDash": 0,
    "\\dashv": 0, "\\varpropto": 0, "\\multimap": 0,
    "\\lhd": 0, "\\rhd": 0, "\\unlhd": 0, "\\unrhd": 0,

    // Set theory
    "\\in": 0, "\\notin": 0, "\\ni": 0, "\\subset": 0, "\\supset": 0,
    "\\subseteq": 0, "\\supseteq": 0, "\\cup": 0, "\\cap": 0, "\\emptyset": 0,
    "\\varnothing": 0, "\\setminus": 0, "\\complement": 0,
    "\\Cup": 0, "\\Cap": 0, "\\Subset": 0, "\\Supset": 0,
    "\\subseteqq": 0, "\\supseteqq": 0,
    "\\nsubseteq": 0, "\\nsupseteq": 0,
    "\\nsubseteqq": 0, "\\nsupseteqq": 0,
    "\\subsetneq": 0, "\\supsetneq": 0,
    "\\subsetneqq": 0, "\\supsetneqq": 0,
    "\\varsubsetneq": 0, "\\varsupsetneq": 0,
    "\\varsubsetneqq": 0, "\\varsupsetneqq": 0,
    "\\sqsubset": 0, "\\sqsupset": 0,
    "\\sqsubseteq": 0, "\\sqsupseteq": 0,
    "\\sqcap": 0, "\\sqcup": 0,
    "\\doublecap": 0, "\\doublecup": 0,
    "\\smallsetminus": 0, "\\uplus": 0,
    "\\sub": 0, "\\sube": 0, "\\supe": 0,
    "\\isin": 0, "\\owns": 0,

    // Logic
    "\\forall": 0, "\\exists": 0, "\\nexists": 0, "\\neg": 0, "\\land": 0,
    "\\lor": 0, "\\implies": 0, "\\impliedby": 0, "\\iff": 0,
    "\\lnot": 0, "\\exist": 0, "\\notni": 0,
    "\\vee": 0, "\\wedge": 0, "\\top": 0, "\\bot": 0,
    "\\therefore": 0, "\\because": 0, "\\And": 0, "\\not": 0,

    // Arrows
    "\\to": 0, "\\mapsto": 0, "\\rightarrow": 0, "\\leftarrow": 0,
    "\\leftrightarrow": 0, "\\uparrow": 0, "\\downarrow": 0,
    "\\updownarrow": 0, "\\Rightarrow": 0, "\\Leftarrow": 0,
    "\\Leftrightarrow": 0, "\\longrightarrow": 0, "\\longleftarrow": 0,
    "\\longmapsto": 0, "\\hookrightarrow": 0, "\\hookleftarrow": 0,
    "\\gets": 0,
    "\\Uparrow": 0, "\\Downarrow": 0, "\\Updownarrow": 0,
    "\\Longrightarrow": 0, "\\Longleftarrow": 0,
    "\\Longleftrightarrow": 0, "\\longleftrightarrow": 0,
    "\\leftarrowtail": 0, "\\rightarrowtail": 0,
    "\\leftharpoondown": 0, "\\leftharpoonup": 0,
    "\\rightharpoondown": 0, "\\rightharpoonup": 0,
    "\\leftleftarrows": 0, "\\rightrightarrows": 0,
    "\\leftrightarrows": 0, "\\rightleftarrows": 0,
    "\\leftrightharpoons": 0, "\\rightleftharpoons": 0,
    "\\leftrightsquigarrow": 0, "\\rightsquigarrow": 0, "\\leadsto": 0,
    "\\Lleftarrow": 0, "\\Rrightarrow": 0, "\\Lsh": 0, "\\Rsh": 0,
    "\\looparrowleft": 0, "\\looparrowright": 0,
    "\\twoheadleftarrow": 0, "\\twoheadrightarrow": 0,
    "\\upharpoonleft": 0, "\\upharpoonright": 0,
    "\\downharpoonleft": 0, "\\downharpoonright": 0,
    "\\upuparrows": 0, "\\downdownarrows": 0,
    "\\dashleftarrow": 0, "\\dashrightarrow": 0,
    "\\circlearrowleft": 0, "\\circlearrowright": 0,
    "\\curvearrowleft": 0, "\\curvearrowright": 0,
    "\\nearrow": 0, "\\nwarrow": 0, "\\searrow": 0, "\\swarrow": 0,
    "\\nleftarrow": 0, "\\nLeftarrow": 0,
    "\\nrightarrow": 0, "\\nRightarrow": 0,
    "\\nleftrightarrow": 0, "\\nLeftrightarrow": 0,
    "\\restriction": 0,
    // Khan-flavored arrow aliases
    "\\larr": 0, "\\rarr": 0, "\\harr": 0, "\\uarr": 0, "\\darr": 0,
    "\\lArr": 0, "\\rArr": 0, "\\hArr": 0, "\\uArr": 0, "\\dArr": 0,
    "\\Larr": 0, "\\Rarr": 0, "\\Harr": 0, "\\Uarr": 0, "\\Darr": 0,
    "\\lrarr": 0, "\\lrArr": 0, "\\Lrarr": 0,

    // Stretchy arrows — take a label in `{}`. Optional below-arg is ignored.
    "\\xleftarrow": 1, "\\xrightarrow": 1,
    "\\xLeftarrow": 1, "\\xRightarrow": 1,
    "\\xleftrightarrow": 1, "\\xLeftrightarrow": 1,
    "\\xhookleftarrow": 1, "\\xhookrightarrow": 1, "\\xmapsto": 1,
    "\\xrightharpoondown": 1, "\\xrightharpoonup": 1,
    "\\xleftharpoondown": 1, "\\xleftharpoonup": 1,
    "\\xrightleftharpoons": 1, "\\xleftrightharpoons": 1,
    "\\xlongequal": 1,
    "\\xtwoheadrightarrow": 1, "\\xtwoheadleftarrow": 1,
    "\\xtofrom": 1,

    // Fractions and radicals
    "\\frac": 2, "\\dfrac": 2, "\\tfrac": 2, "\\cfrac": 2,
    "\\binom": 2, "\\dbinom": 2, "\\tbinom": 2,
    "\\sqrt": 1,

    // Generalized fractions and choice
    "\\genfrac": 6, "\\above": 1,
    "\\over": 0, "\\choose": 0, "\\atop": 0,
    "\\brace": 0, "\\brack": 0,
    "\\mathchoice": 4,

    // Trig and elementary functions
    "\\sin": 0, "\\cos": 0, "\\tan": 0, "\\cot": 0, "\\sec": 0, "\\csc": 0,
    "\\arcsin": 0, "\\arccos": 0, "\\arctan": 0, "\\sinh": 0, "\\cosh": 0,
    "\\tanh": 0, "\\coth": 0, "\\log": 0, "\\ln": 0, "\\lg": 0, "\\exp": 0,
    "\\arctg": 0, "\\arcctg": 0, "\\ch": 0, "\\cosec": 0, "\\cotg": 0,
    "\\ctg": 0, "\\cth": 0, "\\sh": 0, "\\tg": 0, "\\th": 0,

    // Limits and bounds
    "\\lim": 0, "\\limsup": 0, "\\liminf": 0, "\\max": 0, "\\min": 0,
    "\\sup": 0, "\\inf": 0, "\\arg": 0, "\\det": 0, "\\dim": 0, "\\deg": 0,
    "\\gcd": 0, "\\ker": 0, "\\hom": 0,
    "\\Pr": 0, "\\argmax": 0, "\\argmin": 0, "\\plim": 0,
    "\\injlim": 0, "\\projlim": 0,
    "\\varinjlim": 0, "\\varprojlim": 0,
    "\\varliminf": 0, "\\varlimsup": 0,
    "\\bmod": 0, "\\mod": 1, "\\pmod": 1, "\\pod": 1,

    // Symbols
    "\\infty": 0, "\\partial": 0, "\\nabla": 0, "\\cdot": 0, "\\times": 0,
    "\\div": 0, "\\pm": 0, "\\mp": 0, "\\star": 0, "\\ast": 0, "\\circ": 0,
    "\\bullet": 0, "\\oplus": 0, "\\ominus": 0, "\\otimes": 0, "\\oslash": 0,
    "\\odot": 0, "\\dagger": 0, "\\ddagger": 0, "\\ldots": 0, "\\cdots": 0,
    "\\vdots": 0, "\\ddots": 0, "\\prime": 0, "\\hbar": 0, "\\ell": 0,
    "\\Re": 0, "\\Im": 0, "\\wp": 0, "\\aleph": 0, "\\beth": 0,
    "\\gimel": 0, "\\daleth": 0, "\\hslash": 0, "\\mho": 0,
    "\\infin": 0, "\\weierp": 0, "\\alef": 0, "\\alefsym": 0,
    "\\sdot": 0, "\\cdotp": 0, "\\ldotp": 0,
    "\\dots": 0, "\\dotsb": 0, "\\dotsc": 0, "\\dotsi": 0,
    "\\dotsm": 0, "\\dotso": 0, "\\dotsx": 0, "\\mathellipsis": 0,
    "\\surd": 0, "\\angle": 0, "\\angln": 0,
    "\\measuredangle": 0, "\\sphericalangle": 0, "\\backprime": 0,
    "\\triangle": 0, "\\triangledown": 0,
    "\\triangleleft": 0, "\\triangleright": 0, "\\vartriangle": 0,
    "\\blacktriangle": 0, "\\blacktriangledown": 0,
    "\\blacktriangleleft": 0, "\\blacktriangleright": 0,
    "\\square": 0, "\\Box": 0, "\\blacksquare": 0,
    "\\bigstar": 0, "\\bigcirc": 0,
    "\\diamond": 0, "\\Diamond": 0,
    "\\diamondsuit": 0, "\\diamonds": 0,
    "\\heartsuit": 0, "\\hearts": 0,
    "\\clubsuit": 0, "\\clubs": 0,
    "\\spadesuit": 0, "\\spades": 0,
    "\\lozenge": 0, "\\blacklozenge": 0,
    "\\sharp": 0, "\\flat": 0, "\\natural": 0,
    "\\checkmark": 0, "\\maltese": 0,
    "\\copyright": 0, "\\textcopyright": 0, "\\textregistered": 0,
    "\\P": 0, "\\S": 0, "\\yen": 0, "\\pounds": 0,
    "\\mathsterling": 0, "\\textsterling": 0,
    "\\degree": 0, "\\textdegree": 0,
    "\\circledR": 0, "\\circledS": 0,
    "\\circledast": 0, "\\circledcirc": 0, "\\circleddash": 0,
    "\\centerdot": 0, "\\dotplus": 0, "\\doublebarwedge": 0,
    "\\barwedge": 0, "\\veebar": 0,
    "\\curlyvee": 0, "\\curlywedge": 0,
    "\\curlyeqprec": 0, "\\curlyeqsucc": 0,
    "\\divideontimes": 0,
    "\\leftthreetimes": 0, "\\rightthreetimes": 0,
    "\\ltimes": 0, "\\rtimes": 0,
    "\\amalg": 0, "\\intercal": 0, "\\wr": 0,
    "\\boxdot": 0, "\\boxminus": 0, "\\boxplus": 0, "\\boxtimes": 0,
    "\\dag": 0, "\\Dagger": 0,
    "\\diagdown": 0, "\\diagup": 0,
    "\\Finv": 0, "\\Game": 0, "\\eth": 0,
    "\\imath": 0, "\\jmath": 0, "\\i": 0, "\\j": 0,
    "\\backepsilon": 0, "\\backslash": 0,
    "\\imageof": 0, "\\origof": 0, "\\Join": 0,
    "\\thetasym": 0, "\\varcoppa": 0, "\\colon": 0, "\\bull": 0, "\\empty": 0,

    // Text-mode letters and ligatures
    "\\aa": 0, "\\AA": 0, "\\ae": 0, "\\AE": 0,
    "\\oe": 0, "\\OE": 0, "\\o": 0, "\\O": 0, "\\ss": 0,

    // Blackboard-bold and number-set shortcuts
    "\\N": 0, "\\R": 0, "\\Z": 0,
    "\\Complex": 0, "\\Reals": 0, "\\reals": 0, "\\real": 0,
    "\\image": 0, "\\cnums": 0, "\\natnums": 0, "\\Bbbk": 0,

    // Logos
    "\\KaTeX": 0, "\\TeX": 0, "\\LaTeX": 0,

    // Spacing
    "\\quad": 0, "\\qquad": 0,
    "\\thinspace": 0, "\\medspace": 0, "\\thickspace": 0,
    "\\negthinspace": 0, "\\negmedspace": 0, "\\negthickspace": 0,
    "\\enspace": 0, "\\enskip": 0,
    "\\space": 0, "\\nobreakspace": 0, "\\mathstrut": 0,
    "\\nobreak": 0, "\\allowbreak": 0, "\\newline": 0,
    "\\hspace": 1, "\\kern": 1, "\\mkern": 1,
    "\\hskip": 1, "\\mskip": 1,

    // Math-style wrappers
    "\\mathbb": 1, "\\mathcal": 1, "\\mathfrak": 1, "\\mathrm": 1,
    "\\mathbf": 1, "\\mathit": 1, "\\mathsf": 1, "\\mathtt": 1,
    "\\boldsymbol": 1, "\\operatorname": 1,
    "\\mathnormal": 1, "\\mathsfit": 1, "\\mathscr": 1,
    "\\Bbb": 1, "\\bold": 1, "\\frak": 1, "\\bm": 1,
    "\\mathop": 1, "\\mathord": 1, "\\mathbin": 1, "\\mathrel": 1,
    "\\mathopen": 1, "\\mathclose": 1,
    "\\mathpunct": 1, "\\mathinner": 1,

    // Text wrappers
    "\\text": 1, "\\textbf": 1, "\\textit": 1, "\\textrm": 1, "\\textsf": 1,
    "\\texttt": 1, "\\textnormal": 1, "\\textmd": 1, "\\textup": 1,
    "\\emph": 1,

    // Accents and decorations
    "\\hat": 1, "\\widehat": 1, "\\tilde": 1, "\\widetilde": 1, "\\bar": 1,
    "\\overline": 1, "\\underline": 1, "\\vec": 1, "\\overrightarrow": 1,
    "\\overleftarrow": 1, "\\dot": 1, "\\ddot": 1, "\\overbrace": 1,
    "\\underbrace": 1,
    "\\acute": 1, "\\grave": 1, "\\breve": 1, "\\check": 1,
    "\\mathring": 1, "\\widecheck": 1,
    "\\Overrightarrow": 1, "\\overleftrightarrow": 1,
    "\\overgroup": 1, "\\overlinesegment": 1,
    "\\overleftharpoon": 1, "\\overrightharpoon": 1,
    "\\underleftarrow": 1, "\\underrightarrow": 1, "\\underleftrightarrow": 1,
    "\\undergroup": 1, "\\underlinesegment": 1, "\\utilde": 1,
    "\\overbracket": 1, "\\underbracket": 1,
    "\\underbar": 1, "\\dddot": 1, "\\ddddot": 1,

    // Delimiters and sizing — 0-arity because they take a delimiter
    // character (not a braced group) or are themselves delimiter symbols.
    "\\left": 0, "\\right": 0, "\\middle": 0,
    "\\big": 0, "\\Big": 0, "\\bigg": 0, "\\Bigg": 0,
    "\\bigl": 0, "\\bigr": 0, "\\Bigl": 0, "\\Bigr": 0,
    "\\biggl": 0, "\\biggr": 0, "\\Biggl": 0, "\\Biggr": 0,
    "\\bigm": 0, "\\Bigm": 0, "\\biggm": 0, "\\Biggm": 0,
    "\\langle": 0, "\\rangle": 0,
    "\\lceil": 0, "\\rceil": 0, "\\lfloor": 0, "\\rfloor": 0,
    "\\lparen": 0, "\\rparen": 0, "\\lbrack": 0, "\\rbrack": 0,
    "\\lbrace": 0, "\\rbrace": 0,
    "\\lvert": 0, "\\rvert": 0, "\\lVert": 0, "\\rVert": 0,
    "\\vert": 0, "\\Vert": 0,
    "\\lang": 0, "\\rang": 0,
    "\\lgroup": 0, "\\rgroup": 0,
    "\\lmoustache": 0, "\\rmoustache": 0,
    "\\llbracket": 0, "\\rrbracket": 0,
    "\\lBrace": 0, "\\rBrace": 0,
    "\\ulcorner": 0, "\\urcorner": 0,
    "\\llcorner": 0, "\\lrcorner": 0,

    // Enclosing boxes and cancels
    "\\cancel": 1, "\\bcancel": 1, "\\xcancel": 1,
    "\\sout": 1, "\\phase": 1, "\\angl": 1,
    "\\fbox": 1, "\\boxed": 1,
    "\\colorbox": 2, "\\fcolorbox": 3,

    // Color
    "\\color": 1, "\\textcolor": 2,

    // Hyperlinks
    "\\href": 2, "\\url": 1,

    // HTML extensions
    "\\htmlClass": 2, "\\htmlId": 2,
    "\\htmlStyle": 2, "\\htmlData": 2,
    "\\includegraphics": 1,

    // Stacking and overlap
    "\\stackrel": 2, "\\overset": 2, "\\underset": 2,
    "\\mathllap": 1, "\\mathrlap": 1, "\\mathclap": 1,
    "\\llap": 1, "\\rlap": 1, "\\clap": 1,
    "\\phantom": 1, "\\vphantom": 1, "\\hphantom": 1, "\\smash": 1,
    "\\pmb": 1, "\\raisebox": 2, "\\rule": 2,
    "\\hbox": 1, "\\vcenter": 1,

    // Bra-ket and set-builder notation
    "\\bra": 1, "\\Bra": 1, "\\ket": 1, "\\Ket": 1,
    "\\braket": 1, "\\Braket": 1,
    "\\set": 1, "\\Set": 1,

    // Substacks and tags
    "\\substack": 1, "\\tag": 1,

    // Verbatim — `\verb|...|` uses paired delimiters typed by the user.
    "\\verb": 0,

    // Display-style selectors
    "\\displaystyle": 0, "\\textstyle": 0,
    "\\scriptstyle": 0, "\\scriptscriptstyle": 0,

    // Old (plain TeX) font switches
    "\\rm": 0, "\\sf": 0, "\\tt": 0,
    "\\bf": 0, "\\it": 0, "\\cal": 0,

    // Sizing
    "\\tiny": 0, "\\sixptsize": 0, "\\scriptsize": 0,
    "\\footnotesize": 0, "\\small": 0, "\\normalsize": 0,
    "\\large": 0, "\\Large": 0, "\\LARGE": 0,
    "\\huge": 0, "\\Huge": 0,

    // Environments
    "\\begin": 1, "\\end": 1,
};

/**
 * Names of every command in `KATEX_COMMANDS`, computed once at module load
 * so callers ranking against the full set don't pay for `Object.keys` per
 * keystroke.
 */
export const KATEX_COMMAND_NAMES: readonly string[] = Object.keys(KATEX_COMMANDS);

export function arityOf(cmd: string): number {
    return KATEX_COMMANDS[cmd] ?? 0;
}
