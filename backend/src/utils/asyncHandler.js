/**
 * 包装异步路由处理器，把 Promise 拒绝转交给 errorHandler，
 * 避免 Express 4 不自动捕获 async 错误的问题。
 *
 * @param {Function} handler 异步路由处理器
 * @returns {Function} Express 中间件
 */
function asyncHandler(handler) {
    return function wrappedHandler(request, response, next) {
        Promise.resolve(handler(request, response, next)).catch(next);
    };
}

module.exports = asyncHandler;
