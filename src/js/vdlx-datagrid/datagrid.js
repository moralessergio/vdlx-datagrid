import dataTransform, { getAllColumnIndices, getDisplayIndices } from './data-transform';
import { map, combineMap, filter, startWith, combineLatest, withDeepEquals } from './ko-utils';
import withScenarioData from './data-loader';
import Paginator from "./paginator";

const SelectOptions = insightModules.load('components/autotable-select-options');

const createTabulatorFactory = selector => config => new Tabulator(selector, config);
const someEmpty = values => _.some(values, _.isEmpty);
const notSomeEmpty = _.negate(someEmpty);

class Datagrid {
    constructor(root, options$, columnOptions$) {
        this.options$ = options$;
        this.columnOptions$ = columnOptions$;
        this.componentRoot = root;
        this.table = undefined;
        this.buildTable();
    }

    buildTable () {
        const columnOptions$ = this.columnOptions$;
        const options$ = this.options$;

        const schema = insight
            .getView()
            .getProject()
            .getModelSchema();

        const scenariosData$ = _.compose(
            filter(v => v && v.defaultScenario),
            startWith(undefined),
            withScenarioData
        )(columnOptions$);

        const indicesOptions$ = map(_.property('indicesOptions'), columnOptions$);
        const entitiesOptions$ = map(_.property('columnOptions'), columnOptions$);
        const allColumnIndices$ = map(getAllColumnIndices(schema), entitiesOptions$);

        const setNameAndPosns$ = combineMap(
            ([columnIndices, entitiesOptions]) => getDisplayIndices(columnIndices, entitiesOptions),
            [allColumnIndices$, entitiesOptions$]
        );

        const setNamePosnsAndOptions$ = combineMap(
            ([setNameAndPosns, indicesOptions]) =>
                _.map(setNameAndPosns, setNameAndPosn => ({
                    ...setNameAndPosn,
                    options: _.get(indicesOptions, `${setNameAndPosn.name}.${setNameAndPosn.position}`, {
                        id: `${setNameAndPosn.name}_${setNameAndPosn.position}`
                    })
                })),
            [setNameAndPosns$, indicesOptions$]
        );

        const allScenarios$ = map(
            scenariosData =>
                scenariosData && _.uniq([scenariosData.defaultScenario].concat(_.values(scenariosData.scenarios))),
            scenariosData$
        );

        const indicesColumns$ = _.compose(
            map(values => {
                const [setNamePosnsAndOptions, allScenarios] = values;
                return _.map(setNamePosnsAndOptions, setNameAndPosn => {
                    const { name, options } = setNameAndPosn;
                    const entity = schema.getEntity(name);

                    return {
                        title: String(options.title || entity.getAbbreviation() || name),
                        field: options.id,
                        mutator: (value, data, type, params) => SelectOptions.getLabel(schema, allScenarios, entity, value)
                    };
                });
            }),
            withDeepEquals,
            filter(notSomeEmpty),
            startWith([]),
            combineLatest
        )([setNamePosnsAndOptions$, allScenarios$]);

        const entitiesColumns$ = map(
            entitiesOptions => _.map(entitiesOptions, entityOptions => {
                const entity = schema.getEntity(entityOptions.name);

                return _.assign(entityOptions, {
                    title: String(entityOptions.title || entity.getAbbreviation() || entityOptions.name),
                    field: entityOptions.id
                });

            }),
            entitiesOptions$
        );

        const columns$ = _.compose(
            map(_.flatten),
            filter(notSomeEmpty),
            startWith([]),
            combineLatest
        )([indicesColumns$, entitiesColumns$]);

        const tabulatorFactory$ = map(
            options => (options.tableId ? createTabulatorFactory(`#${options.tableId}`) : _.noop),
            options$
        );

        const tabulatorOptions$ = map(
            options => ({
                layout: 'fitColumns',
                placeholder: 'Waiting for data',
                groupStartOpen: false,
                ajaxLoader: true,
                columns: [],
                tableBuilt: _.partial(this.tableBuilt, this)
            }),
            options$
        );

        const table$ = combineMap(([factory, options]) => factory(options), [tabulatorFactory$, tabulatorOptions$]);

        table$.subscribe(oldTable => oldTable && oldTable.destroy(), null, 'beforeChange');

        const data$ = _.compose(
            map(params => params && dataTransform(...params)),
            filter(notSomeEmpty),
            startWith(undefined),
            combineLatest
        )([allColumnIndices$, entitiesColumns$, setNamePosnsAndOptions$, scenariosData$]);

        _.compose(
            map(values => {
                if (!values) {
                    return false;
                }
                const [table, columns, data] = values;
                table.setColumns(columns);

                return table
                    .setData(data)
                    .then(function () {
                        table.redraw();
                    })
                    .catch(function (err) {
                        debugger;
                    });
            }),
            filter(notSomeEmpty),
            startWith(undefined),
            combineLatest
        )([table$, columns$, data$]).subscribe(_.noop);
    }

    tableBuilt (self) {
        let $componentRoot = $(self.componentRoot);
        let $footerToolBar = $componentRoot.find('.footer-toolbar');
        const paginatorControl = new Paginator(this);
        paginatorControl.appendTo($footerToolBar);
    }
}

export default Datagrid;