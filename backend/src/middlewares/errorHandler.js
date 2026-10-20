const { HttpError } = require('../utils/errors');

/**
 * 全局错误处理中间件：把所有错误转成规范响应 { code, message, data }。
 */
function errorHandler(error, request, response, next) {
    // 业务错误：直接返回对应状态码和业务错误码。
    if (error instanceof HttpError) {
        return response.status(error.httpStatus).json({
            code: error.code,
            message: error.message,
            data: null,
        });
    }

    // multer 文件过大。
    if (error && error.code === 'LIMIT_FILE_SIZE') {
        return response.status(413).json({
            code: 41300,
            message: '文件过大',
            data: null,
        });
    }

    // express.json 解析失败（非法 JSON 请求体）。
    if (error && error.type === 'entity.parse.failed') {
        return response.status(400).json({
            code: 40000,
            message: '请求体不是合法的 JSON',
            data: null,
        });
    }

    // 未知错误：记录日志并返回 500。
    console.error('[errorHandler]', error);
    return response.status(500).json({
        code: 50000,
        message: '服务器内部错误',
        data: null,
    });
}

module.exports = errorHandler;
