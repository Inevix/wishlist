const {
    Scenes: { WizardScene },
    Markup
} = require('telegraf');
const User = require('../models/user');
const Wish = require('../models/wish');
const Give = require('../models/give');
const { resetTimer, setTimer } = require('../helpers/timer');
const getWishMarkup = require('../helpers/wish-markup');
const getMediaGroup = require('../helpers/media-group');
const getComplexStepHandler = require('../helpers/complex-step-handler');
const { GREETING, FIND_LIST, THIRD_WISHLIST } = require('./types');
const { GIVE, TAKE } = {
    GIVE: 'give_',
    TAKE: 'take_'
};

const stepHandler = getComplexStepHandler([GREETING, FIND_LIST]);

const getExistingWishInGiveList = async (ctx, wishId) => {
    if (!wishId) {
        await ctx.sendMessage(
            ctx.session.messages.errors.unknown,
            Markup.removeKeyboard()
        );

        return await setTimer(ctx, THIRD_WISHLIST);
    }

    const wish = await Wish.findById(wishId);

    if (!wish) {
        await ctx.sendMessage(
            ctx.session.messages.errors.unknown,
            Markup.removeKeyboard()
        );

        return await setTimer(ctx, THIRD_WISHLIST);
    }

    const existingInWishList = await Give.findOne({
        userId: ctx.session.user._id,
        wishId
    });

    return {
        wish,
        existingInWishList
    };
};

stepHandler.action(new RegExp(GIVE), async ctx => {
    const wishId = ctx.update.callback_query.data.replace(GIVE, '');
    const { existingInWishList, wish } = await getExistingWishInGiveList(
        ctx,
        wishId
    );

    if (existingInWishList) {
        await ctx.replyWithMarkdown(
            ctx.session.messages.findList.errors.give +
                ctx.session.messages.findList.back,
            Markup.removeKeyboard()
        );

        return await setTimer(ctx, THIRD_WISHLIST);
    }

    const give = await new Give({
        userId: ctx.session.user._id,
        wishId: wish._id
    });

    await give.save();

    await ctx.replyWithMarkdown(
        ctx.session.messages.findList.success.give +
            ctx.session.messages.findList.back,
        Markup.removeKeyboard()
    );

    return await setTimer(ctx, THIRD_WISHLIST);
});

stepHandler.action(new RegExp(TAKE), async ctx => {
    const wishId = ctx.update.callback_query.data.replace(TAKE, '');
    const { existingInWishList, wish } = await getExistingWishInGiveList(
        ctx,
        wishId
    );

    if (!existingInWishList) {
        await ctx.replyWithMarkdown(
            ctx.session.messages.findList.errors.take +
                ctx.session.messages.findList.back,
            Markup.removeKeyboard()
        );

        return await setTimer(ctx, THIRD_WISHLIST);
    }

    await Give.deleteOne({
        userId: ctx.session.user._id,
        wishId: wish._id
    });
    await ctx.replyWithMarkdown(
        ctx.session.messages.findList.success.take +
            ctx.session.messages.findList.back,
        Markup.removeKeyboard()
    );

    return await setTimer(ctx, THIRD_WISHLIST);
});

const ThirdWishlist = new WizardScene(
    THIRD_WISHLIST,
    async ctx => {
        if (!ctx.session.thirdWishlist) {
            await ctx.sendMessage(
                ctx.session.messages.errors.unknown,
                Markup.removeKeyboard()
            );

            return await setTimer(ctx, FIND_LIST);
        }

        const username = ctx.session.thirdWishlist.replace(/@/g, '');
        const phone = ctx.session.thirdWishlist.replace(/\D/g, '');
        const searchCriteria =
            phone && phone.length > 9
                ? {
                      $or: [
                          { username },
                          { phone: { $regex: new RegExp(phone) } }
                      ]
                  }
                : { username };

        const user = await User.findOne(searchCriteria);

        if (!user) {
            await ctx.sendMessage(
                ctx.session.messages.findList.errors.notFound +
                    ctx.session.messages.findList.back,
                Markup.removeKeyboard()
            );

            return await setTimer(ctx, FIND_LIST);
        }

        if (user._id.toString() === ctx.session.user._id.toString()) {
            await ctx.sendMessage(
                ctx.session.messages.findList.errors.foundYourself +
                    ctx.session.messages.findList.back,
                Markup.removeKeyboard()
            );

            return await setTimer(ctx, FIND_LIST);
        }

        const wishlist = await Wish.find({
            userId: user._id
        }).sort({
            priority: -1,
            updatedAt: -1
        });

        if (!wishlist.length) {
            await ctx.sendMessage(
                ctx.session.messages.findList.empty,
                Markup.removeKeyboard()
            );

            return await setTimer(ctx, FIND_LIST);
        }

        await ctx.replyWithMarkdown(
            ctx.session.messages.findList.filled.before.replace(
                '%1',
                ctx.session.thirdWishlist
            ),
            Markup.removeKeyboard()
        );

        for await (const wish of wishlist) {
            const markup = await getWishMarkup(ctx, wish, false);

            if (!markup) continue;

            const givers = await Give.find({
                wishId: wish._id
            });
            const existInGiveList = await Give.findOne({
                userId: ctx.session.user._id,
                wishId: wish._id
            });
            const buttons = [];

            if (givers.length === 1 && existInGiveList) {
                markup.concat(ctx.session.messages.findList.givers.you);
            } else if (givers.length > 1 && existInGiveList) {
                markup.concat(
                    ctx.session.messages.findList.givers.somebodyAndYou.replace(
                        '%1',
                        (givers.length - 1).toString()
                    )
                );
            } else if (givers.length && !existInGiveList) {
                markup.concat(
                    ctx.session.messages.findList.givers.somebody.replace(
                        '%1',
                        givers.length.toString()
                    )
                );
            }

            if (wish.link) {
                buttons.push(
                    Markup.button.url(
                        ctx.session.messages.actions.open,
                        wish.link
                    )
                );
            }

            if (existInGiveList) {
                buttons.push(
                    Markup.button.callback(
                        ctx.session.messages.findList.actions.take,
                        TAKE.concat(wish._id)
                    )
                );
            } else {
                buttons.push(
                    Markup.button.callback(
                        ctx.session.messages.findList.actions.give,
                        GIVE.concat(wish._id)
                    )
                );
            }

            const extra = buttons.length
                ? {
                      ...Markup.inlineKeyboard(buttons, {
                          columns: 1
                      })
                  }
                : { ...Markup.removeKeyboard() };

            if (wish.images.length > 1) {
                await ctx.sendMediaGroup(getMediaGroup(wish.images));
            } else if (wish.images.length === 1) {
                await ctx.sendPhoto(wish.images[0], {
                    caption: markup,
                    parse_mode: 'Markdown',
                    ...extra
                });
            }

            if (wish.images.length !== 1) {
                await ctx.replyWithMarkdown(markup, extra);
            }
        }

        await ctx.replyWithMarkdown(
            ctx.session.messages.findList.filled.after,
            Markup.inlineKeyboard(
                [
                    Markup.button.callback(
                        ctx.session.messages.actions.back,
                        FIND_LIST
                    ),
                    Markup.button.callback(
                        ctx.session.messages.actions.home,
                        GREETING
                    )
                ],
                {
                    columns: 1
                }
            )
        );

        return ctx.wizard.next();
    },
    stepHandler
);

module.exports = ThirdWishlist;
