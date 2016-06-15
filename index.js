var QA_DISPLAYNAME_IDENTIFIER = "data-displayname";
var QA_PROP_PREFIX = 'data-prop-';

var PROPTYPES_TO_RECORD = ['number', 'string', 'bool'];

function nameOrValueIs(target, name) {
    return target.name === name || target.value === name;
}

module.exports = function (babel) {

    var t = babel.types;

    var createClassMatcher = t.buildMatchMemberExpression("React.createClass");
    var createElementMatcher = t.buildMatchMemberExpression("React.createElement");
    var propTypeMatch = t.buildMatchMemberExpression("React.PropTypes");

    function getPropType(node) {
        if (!node.object) {
            return;
        }        
        
        if (propTypeMatch(node.object)) {
            return node.property.name;
        } else if (node.object.object && propTypeMatch(node.object.object)) {
            return node.object.property.name;
        }
    }

    function isReactCreateClass(node) {
        return createClassMatcher(node);
    }

    function isReactCreateElementDOMNode(node) {

        return t.isCallExpression(node) &&
                createElementMatcher(node.callee) &&
                node.arguments.length > 0 &&
                node.arguments[0].type !== 'Identifier';
    }

    // visitor that adds extra props to CreateElement in render
    var returnStatementVisitor = {
        ReturnStatement: function (path) {
            var displayName = this.displayName;
            var props = this.propTypes;
            var stringLiteralDisplayName = t.stringLiteral(displayName);

            var argument = path.node.argument;

            if (t.isJSXElement(argument)) {
                var openingElement = argument.openingElement;

                // update or add the displayname. could already be set by us earlier (if there are multiple components in a file).
                // if it's here already, update it; else add it
                var displayNameJSXExpression = t.jSXExpressionContainer(stringLiteralDisplayName);
                var foundDisplayName = false;
                openingElement.attributes.forEach(function (attr) {

                    if (t.isJSXAttribute(attr) && attr.name.name === QA_DISPLAYNAME_IDENTIFIER) {
                        foundDisplayName = true;
                        attr.value = displayNameJSXExpression;
                    }
                });

                if (!foundDisplayName) {
                    var jSXAttribute = t.jSXAttribute(t.jSXIdentifier(QA_DISPLAYNAME_IDENTIFIER), displayNameJSXExpression);
                    openingElement.attributes.push(jSXAttribute);                    
                }

                // add proptype attributes
                props.forEach(function (prop) {
                    var name = QA_PROP_PREFIX + prop.toLowerCase();
                    var value = t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier('props')), t.identifier(prop));

                    var jSXAttribute = t.jSXAttribute(t.jSXIdentifier(name), t.jSXExpressionContainer(value));
                    openingElement.attributes.push(jSXAttribute);
                });
                
            }
        }
    };

    // find method called "render"
    var renderMethodVisitorFn = function (path) {
        var node = path.node;

        var displayName = this.displayName;
        var propTypes = this.propTypes;
        var context = {
            displayName: displayName,
            propTypes: propTypes
        };

        if (nameOrValueIs(path.node.key, 'render')) {
            path.traverse(returnStatementVisitor, context);
        }
    };

    var renderMethodVisitor = {
        ObjectMethod: renderMethodVisitorFn,
        ObjectProperty: renderMethodVisitorFn
    };

    // Finds CreateClass calls
    var visitor = {
        visitor: {
            CallExpression: function (path) {

                var node = path.node;
                if (!isReactCreateClass(node.callee)) { return; }

                // find displayName and proptypes
                var displayName;
                var propTypes;

                node.arguments[0].properties.forEach(function (property) {
                    if (nameOrValueIs(property.key, 'displayName')) {
                        displayName = property.value.value;
                    }

                    if (nameOrValueIs(property.key, 'propTypes')) {
                        propTypes = property.value;
                    }
                });

                if (displayName) {

                    // figure out which props to record
                    var recordPropTypes = [];
                    if (propTypes) {
                        propTypes.properties.forEach(function (propType) {
                            
                            if (PROPTYPES_TO_RECORD.indexOf(getPropType(propType.value)) > -1) {
                                recordPropTypes.push(propType.key.name);
                            }

                        });
                    }

                    var context = {
                        displayName: displayName,
                        propTypes: recordPropTypes
                    };

                    // traverse to the render method
                    path.traverse(renderMethodVisitor, context);
                }

            }
        }
    };

    return visitor;

}
