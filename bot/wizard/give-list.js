const {
    Scenes: { WizardScene },
    Markup
} = require('telegraf');
const Give = require('../models/give');
const Wish = require('../models/wish');
const User = require('../models/user');
const getComplexStepHandler = require('../helpers/complex-step-handler');
const getWishMarkup = require('../helpers/wish-markup');
const getMediaGroup = require('../helpers/media-group');
const { resetTimer, setTimer } = require('../helpers/timer');
const { GREETING, GIVE_LIST, FIND_LIST } = require('./types');
const { REMOVE, CLEAN } = {
    REMOVE: 'remove_',
    CLEAN: 'clean'
};

const stepHandler = getComplexStepHandler([GREETING, FIND_LIST]);

stepHandler.action(new RegExp(REMOVE), async ctx => {
    const giveId = ctx.update.callback_query.data.replace(REMOVE, '');

    await Give.findOneAndDelete(giveId);

    await ctx.replyWithMarkdown(
        ctx.session.messages.giveList.success.remove +
            ctx.session.messages.giveList.back,
        Markup.removeKeyboard()
    );

    return await setTimer(ctx, GIVE_LIST);
});

stepHandler.action(CLEAN, async ctx => {
    await Give.deleteMany({
        userId: ctx.session.user._id
    });

    await ctx.replyWithMarkdown(
        ctx.session.messages.giveList.success.clean +
            ctx.session.messages.giveList.back,
        Markup.removeKeyboard()
    );

    return await setTimer(ctx, GREETING);
});

const GiveList = new WizardScene(
    GIVE_LIST,
    async ctx => {
        await resetTimer(ctx);

        const giveList = await Give.find({
            userId: ctx.session.user._id
        });

        if (!giveList.length) {
            await ctx.replyWithMarkdown(
                ctx.session.messages.giveList.empty,
                Markup.inlineKeyboard(
                    [
                        Markup.button.callback(
                            ctx.session.messages.findList.title,
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
        }

        await ctx.replyWithMarkdown(
            ctx.session.messages.giveList.filled.before,
            Markup.removeKeyboard()
        );

        for await (const give of giveList) {
            const wish = await Wish.findById(give.wishId);

            if (!wish) {
                await give.deleteOne();

                continue;
            }

            let markup = await getWishMarkup(ctx, wish, false);

            if (!markup) continue;
            const user = await User.findById(wish.userId);
            const userReference = user.username
                ? `@${user.username}`
                : user.phone;
            const givers = await Give.find({
                wishId: wish._id
            });
            const buttons = [];

            if (givers.length > 1) {
                markup = markup.concat(
                    ctx.session.messages.giveList.givers.replace(
                        '%1',
                        (givers.length - 1).toString()
                    )
                );
            }

            markup = markup.concat(
                ctx.session.messages.giveList.owner.replace('%1', userReference)
            );

            if (wish.link) {
                buttons.push(
                    Markup.button.url(
                        ctx.session.messages.actions.open,
                        wish.link
                    )
                );
            }

            buttons.push(
                Markup.button.callback(
                    ctx.session.messages.findList.actions.take,
                    REMOVE.concat(wish._id)
                )
            );

            if (wish.images.length > 1) {
                await ctx.sendMediaGroup(getMediaGroup(wish.images));
            } else if (wish.images.length === 1) {
                await ctx.sendPhoto(wish.images[0], {
                    caption: markup,
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons, {
                        columns: 1
                    })
                });
            }

            if (wish.images.length !== 1) {
                await ctx.replyWithMarkdown(
                    markup,
                    Markup.inlineKeyboard(buttons, {
                        columns: 1
                    })
                );
            }
        }

        await ctx.replyWithMarkdown(
            ctx.session.messages.giveList.filled.after,
            Markup.inlineKeyboard(
                [
                    Markup.button.callback(
                        ctx.session.messages.actions.clean,
                        CLEAN
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

module.exports = GiveList;
