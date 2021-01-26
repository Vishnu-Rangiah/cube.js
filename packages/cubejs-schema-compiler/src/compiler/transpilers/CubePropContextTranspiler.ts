import * as t from '@babel/types';
import R from 'ramda';
import { TranspilerInterface, TraverseObject } from './transpiler.interface';
import type { CubeSymbols } from '../CubeSymbols';
import type { CubeDictionary } from '../CubeDictionary';
import { ErrorReporter } from '../ErrorReporter';

export class CubePropContextTranspiler implements TranspilerInterface {
  public constructor(
    protected readonly cubeSymbols: CubeSymbols,
    protected readonly cubeDictionary: CubeDictionary,
  ) {
  }

  public traverseObject(): TraverseObject {
    const self = this;
    return {
      CallExpression(path) {
        const args = path.get('arguments');
        if (path.node.callee && path.node.callee.type === 'Identifier' && (path.node.callee.name === 'view' || path.node.callee.name === 'cube')) {
          if (args && args[args.length - 1]) {
            const cubeName = args[0].node.type === 'StringLiteral' && args[0].node.value ||
              args[0].node.type === 'TemplateLiteral' &&
              args[0].node.quasis.length &&
              args[0].node.quasis[0].value.cooked;
            args[args.length - 1].traverse(self.sqlAndReferencesFieldVisitor(cubeName));
            args[args.length - 1].traverse(
              self.knownIdentifiersInjectVisitor('extends', name => self.cubeDictionary.resolveCube(name))
            );
          }
          // @ts-ignore @todo Unsafely?
        } else if (path.node.callee.name === 'context') {
          args[args.length - 1].traverse(self.sqlAndReferencesFieldVisitor(null));
          // @ts-ignore @todo Unsafely?
        } else if (path.node.callee.name === 'dashboardTemplate') {
          args[args.length - 1].traverse(self.shortNamedReferencesFieldVisitor(null));
        }
      }
    };
  }

  protected sqlAndReferencesFieldVisitor(cubeName) {
    return this.knownIdentifiersInjectVisitor(
      /^(sql|measureReferences|dimensionReferences|segmentReferences|timeDimensionReference|rollupReferences|drillMembers|drillMemberReferences|contextMembers|columns)$/,
      name => this.cubeSymbols.resolveSymbol(cubeName, name) || this.cubeSymbols.isCurrentCube(name)
    );
  }

  protected shortNamedReferencesFieldVisitor(cubeName) {
    return this.knownIdentifiersInjectVisitor(
      /^.*(measures|dimensions|segments|measure|dimension|segment|member)$/,
      name => this.cubeSymbols.resolveSymbol(cubeName, name) || this.cubeSymbols.isCurrentCube(name)
    );
  }

  protected knownIdentifiersInjectVisitor(field, resolveSymbol) {
    const self = this;
    return {
      ObjectProperty(path) {
        if (path.node.key.type === 'Identifier' && path.node.key.name.match(field)) {
          const knownIds = self.collectKnownIdentifiers(
            resolveSymbol,
            path.get('value')
          );
          path.get('value').replaceWith(
            t.arrowFunctionExpression(knownIds.map(i => t.identifier(i)), path.node.value, false)
          );
        }
      }
    };
  }

  protected collectKnownIdentifiers(resolveSymbol, path) {
    const identifiers = [];
    const self = this;
    if (path.node.type === 'Identifier') {
      this.matchAndPushIdentifier(path, resolveSymbol, identifiers);
    }
    path.traverse({
      Identifier(p) {
        self.matchAndPushIdentifier(p, resolveSymbol, identifiers);
      }
    });
    return R.uniq(identifiers);
  }

  protected matchAndPushIdentifier(path, resolveSymbol, identifiers) {
    if (
      (!path.parent ||
        (path.parent.type !== 'MemberExpression' || path.parent.type === 'MemberExpression' && path.key !== 'property')
      ) &&
      resolveSymbol(path.node.name)
    ) {
      identifiers.push(path.node.name);
    }
  }
}
