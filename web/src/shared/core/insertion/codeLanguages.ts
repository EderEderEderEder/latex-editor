export interface CodeLanguage {
    readonly title: string;
    /** Umgebung aus `hgblistings.sty` */
    readonly environment: string;
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
    ['Allgemein (ohne Sprache)', 'GenericCode'],
    ['Bash', 'BashCode'],
    ['C', 'CCode'],
    ['C++', 'CppCode'],
    ['C#', 'CsCode'],
    ['CSS', 'CssCode'],
    ['Dart', 'DartCode'],
    ['GLSL', 'GlslCode'],
    ['Go', 'GoCode'],
    ['HTML', 'HtmlCode'],
    ['Java', 'JavaCode'],
    ['JavaScript', 'JsCode'],
    ['JSON', 'JsonCode'],
    ['Kotlin', 'KotlinCode'],
    ['LaTeX', 'LaTeXCode'],
    ['MATLAB', 'MatlabCode'],
    ['Objective-C', 'ObjCCode'],
    ['PHP', 'PhpCode'],
    ['Python', 'PythonCode'],
    ['R', 'RCode'],
    ['Rust', 'RustCode'],
    ['Scala', 'ScalaCode'],
    ['SQL', 'SqlCode'],
    ['Swift', 'SwiftCode'],
    ['TypeScript', 'TsCode'],
    ['XML', 'XmlCode'],
    ['YAML', 'YamlCode'],
].map(([title, environment]) => ({ title: title!, environment: environment! }));

export const DEFAULT_CODE_ENVIRONMENT = 'PythonCode';
