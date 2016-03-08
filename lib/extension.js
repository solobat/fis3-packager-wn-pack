


/**
 * 初始化 fis 扩展
 *
 * @param {Object} fis fis 实例
 */
exports.init = function (fis) {
    var _ = fis.util;
    _.assign(_, require('fism-helper'));

    // 重写 applyMatches 方法，主要为了修复 fis 的 plugin 不支持传入选择值非普通对象情况
    var rawApplyMatches = fis.util.applyMatches;
    fis.util.applyMatches = function () {
        var _ = fis.util;
        var rawCloneDeep = _.cloneDeep;

        _.cloneDeep = function () {
            var args = arguments;
            var flag;
            if (args.length === 1
                || (flag = args.length === 2 && !_.isFunction(args[1]))
            ) {
                args = Array.prototype.slice.apply(args);
                if (flag) {
                    args[2] = args[1];
                }

                args[1] = function (value) {
                    // 对于非普通对象，直接不克隆，主要为了避免传入的选项值是某些实例对象，
                    // 比如 less 的 plugin 的值
                    if (value && typeof value === 'object'
                        && !_.isArray(value)
                        && !_.isPlainObject(value)
                    ) {
                        return value;
                    }
                };
            }

            return rawCloneDeep.apply(this, args);
        };

        var result = rawApplyMatches.apply(this, arguments);
        _.cloneDeep = rawCloneDeep;

        return result;
    };
};
