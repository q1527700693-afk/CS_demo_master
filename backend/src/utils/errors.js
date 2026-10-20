/**
 * 业务错误：携带 HTTP 状态码与业务错误码，
 * 由 errorHandler 统一捕获并转成规范响应。
 */
class HttpError extends Error {
    /**
     * @param {number} httpStatus HTTP 状态码
     * @param {number} code 业务错误码
     * @param {string} message 提示信息
     */
    constructor(httpStatus, code, message) {
        super(message);
        this.name = 'HttpError';
        this.httpStatus = httpStatus;
        this.code = code;
    }
}

module.exports = {
    HttpError,
};
